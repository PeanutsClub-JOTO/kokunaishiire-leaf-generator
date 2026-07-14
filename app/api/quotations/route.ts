/**
 * POST /api/quotations — 見積書取込（xlsx/gsheet/pdf）
 *
 * xlsx: multipart/form-data でファイルをアップロード
 * gsheet: JSON body { source_type: 'gsheet', source_ref: 'SPREADSHEET_ID' }
 *
 * 取込ジョブを jobs テーブルにキューイングして、非同期処理に委譲する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import {
  detectQuotationSourceType,
  quotationUploadContentType,
  safeQuotationStorageName,
} from '@/lib/storage/quotation-file';

type BundleManifest = {
  version: 1;
  files: Array<{
    originalName: string;
    storageName: string;
    storagePath: string;
    sourceType: 'xlsx';
  }>;
};

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  const contentType = req.headers.get('content-type') ?? '';

  let sourceType: 'xlsx' | 'gsheet' | 'pdf' | 'eml' | null = null;
  let sourceRef: string | null = null;
  let fileName: string | null = null;
  let fileBuffer: Buffer | null = null;
  let bundleFiles: File[] = [];

  if (contentType.includes('multipart/form-data')) {
    // ファイルアップロード
    const form = await req.formData();
    const multiFiles = form.getAll('files').filter((value): value is File => value instanceof File);
    const singleFile = form.get('file') as File | null;
    const files = multiFiles.length > 0 ? multiFiles : singleFile ? [singleFile] : [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    if (files.length > 1) {
      for (const file of files) {
        const detected = detectQuotationSourceType(file.name);
        if (detected !== 'xlsx') {
          return NextResponse.json(
            { error: '複数資料の同時取り込みは .xlsx .xls のみ対応しています' },
            { status: 400 },
          );
        }
      }
      sourceType = 'eml';
      sourceRef = `multi-${Date.now()}.json`;
      bundleFiles = files;
    } else {
      const file = files[0];
      const detected = detectQuotationSourceType(file.name);
      if (!detected) {
        return NextResponse.json(
          { error: '対応ファイルは .xlsx .xls .pdf のみです' },
          { status: 400 },
        );
      }

      sourceType = detected;
      fileName = safeQuotationStorageName(file.name);

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      sourceRef = fileName;
    }
  } else {
    // JSON（GSheet）
    const body = await req.json();
    if (!body.source_ref) {
      return NextResponse.json({ error: 'source_ref is required' }, { status: 400 });
    }
    sourceType = 'gsheet';
    sourceRef = body.source_ref;
  }

  if (!sourceType || !sourceRef) {
    return NextResponse.json({ error: 'source could not be resolved' }, { status: 400 });
  }

  if (contentType.includes('multipart/form-data') && bundleFiles.length === 0 && !fileBuffer) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // quotations レコード作成
  const { data: quotation, error: qErr } = await supabase
    .from('quotations')
    .insert({
      source_type: sourceType,
      source_ref: sourceRef,
      client_name: 'ピーナッツクラブ',
    })
    .select()
    .single();

  if (qErr || !quotation) {
    return NextResponse.json({ error: qErr?.message ?? 'DB error' }, { status: 500 });
  }

  // ファイルを Supabase Storage に保存（xlsx/pdf の場合）
  if (fileBuffer && fileName) {
    const storagePath = `quotations/${quotation.id}/${fileName}`;
    const { error: storageErr } = await supabase.storage
      .from('quotation-files')
      .upload(storagePath, fileBuffer, {
        contentType: quotationUploadContentType(fileName),
      });

    if (storageErr) {
      console.warn('Storage upload failed:', storageErr.message);
      await supabase.from('quotations').delete().eq('id', quotation.id);
      return NextResponse.json(
        { error: `見積書ファイルの保存に失敗しました: ${storageErr.message}` },
        { status: 500 },
      );
    }
  }

  // 複数Excel資料を1案件として保存
  if (bundleFiles.length > 0) {
    const manifest: BundleManifest = { version: 1, files: [] };

    for (let i = 0; i < bundleFiles.length; i++) {
      const file = bundleFiles[i];
      const storageName = safeQuotationStorageName(file.name, Date.now() + i);
      const storagePath = `quotations/${quotation.id}/bundle/${storageName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: storageErr } = await supabase.storage
        .from('quotation-files')
        .upload(storagePath, buffer, {
          contentType: quotationUploadContentType(file.name),
        });

      if (storageErr) {
        console.warn('Bundle file upload failed:', storageErr.message);
        await supabase.from('quotations').delete().eq('id', quotation.id);
        return NextResponse.json(
          { error: `複数資料の保存に失敗しました: ${storageErr.message}` },
          { status: 500 },
        );
      }

      manifest.files.push({
        originalName: file.name,
        storageName,
        storagePath,
        sourceType: 'xlsx',
      });
    }

    const manifestPath = `quotations/${quotation.id}/${sourceRef}`;
    const { error: manifestErr } = await supabase.storage
      .from('quotation-files')
      .upload(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)), {
        contentType: 'application/json',
      });
    if (manifestErr) {
      console.warn('Bundle manifest upload failed:', manifestErr.message);
      await supabase.from('quotations').delete().eq('id', quotation.id);
      return NextResponse.json(
        { error: `複数資料の管理情報保存に失敗しました: ${manifestErr.message}` },
        { status: 500 },
      );
    }
  }

  // ジョブをキューに追加
  const jobType =
    sourceType === 'gsheet'
      ? 'import_gsheet'
      : sourceType === 'pdf'
        ? 'import_pdf'
        : sourceType === 'eml'
          ? 'import_eml'
          : 'import_xlsx';

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      quotation_id: quotation.id,
      job_type: jobType,
      status: 'queued',
    })
    .select()
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'Job creation failed' }, { status: 500 });
  }

  return NextResponse.json({
    quotation_id: quotation.id,
    job_id: job.id,
    status: 'queued',
  });
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('quotations')
    .select('*, sheets(id, sheet_name, maker_name)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ quotations: data });
}
