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

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  const contentType = req.headers.get('content-type') ?? '';

  let sourceType: 'xlsx' | 'gsheet' | 'pdf';
  let sourceRef: string;
  let fileName: string | null = null;
  let fileBuffer: Buffer | null = null;

  if (contentType.includes('multipart/form-data')) {
    // ファイルアップロード
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

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
  } else {
    // JSON（GSheet）
    const body = await req.json();
    if (!body.source_ref) {
      return NextResponse.json({ error: 'source_ref is required' }, { status: 400 });
    }
    sourceType = 'gsheet';
    sourceRef = body.source_ref;
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

  // ジョブをキューに追加
  const jobType =
    sourceType === 'gsheet'
      ? 'import_gsheet'
      : sourceType === 'pdf'
        ? 'import_pdf'
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
