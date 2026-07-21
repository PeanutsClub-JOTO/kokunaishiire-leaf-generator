import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';
import { extractXlsxCells } from '../../lib/import/xlsx-cells';
import { extractXlsxImages } from '../../lib/import/xlsx-images';
import { extractXlsImages, isLegacyXls } from '../../lib/import/xls-images';
import {
  mergeWorkbookBundle,
  type MergedProductImage,
  type WorkbookBundleSource,
} from '../../lib/import/multi-file-bundle';
import { loadSettings, processRawSheets } from './import-xlsx';
import { upscaleImageBuffer } from '../../lib/leaf/upscale-image';

type Supabase = SupabaseClient<Database>;
type Job = Database['public']['Tables']['jobs']['Row'];

type BundleManifest = {
  version: 1;
  files: Array<{
    originalName: string;
    storageName: string;
    storagePath: string;
    sourceType: 'xlsx';
  }>;
};

async function downloadStorageBuffer(
  supabase: Supabase,
  bucket: string,
  storagePath: string,
): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error(`Storage download failed: ${storagePath}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function readBundleManifest(
  supabase: Supabase,
  quotation: Database['public']['Tables']['quotations']['Row'],
): Promise<BundleManifest> {
  if (!quotation.source_ref) throw new Error('Bundle manifest source_ref is missing');
  const manifestPath = `quotations/${quotation.id}/${quotation.source_ref}`;
  const buffer = await downloadStorageBuffer(supabase, 'quotation-files', manifestPath);
  const parsed = JSON.parse(buffer.toString('utf8')) as BundleManifest;
  if (parsed.version !== 1 || !Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error('Invalid bundle manifest');
  }
  return parsed;
}

async function extractWorkbookSource(fileName: string, buffer: Buffer): Promise<WorkbookBundleSource> {
  const sheets = extractXlsxCells(buffer);
  const legacy = isLegacyXls(buffer);
  const imageResult = legacy
    ? await extractXlsImages(buffer, { includeInlineAnchors: true })
    : await extractXlsxImages(buffer, { includeInlineAnchors: true });

  return {
    fileName,
    sheets,
    images: imageResult.images,
  };
}

async function uploadMergedProductImages(
  supabase: Supabase,
  processedProducts: Awaited<ReturnType<typeof processRawSheets>>,
  productImages: MergedProductImage[],
): Promise<number> {
  const productByPosition = new Map(
    processedProducts.map((product) => [
      `${product.sheetName ?? ''}|${product.sourceIndex}`,
      product.id,
    ]),
  );

  let uploaded = 0;
  for (const productImage of productImages) {
    const productId = productByPosition.get(
      `${productImage.sheetName ?? ''}|${productImage.sourceIndex}`,
    );
    if (!productId) continue;

    let uploadBuffer = productImage.image.buffer;
    let contentType = productImage.image.mimeType;
    let ext = productImage.image.mimeType.split('/')[1] ?? 'png';

    try {
      uploadBuffer = await upscaleImageBuffer(productImage.image.buffer);
      contentType = 'image/png';
      ext = 'png';
    } catch (upscaleErr) {
      console.warn('[import-eml] Image upscale failed, uploading original:', upscaleErr);
    }

    const imgPath = `products/${productId}/image.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('product-images')
      .upload(imgPath, uploadBuffer, { contentType, upsert: true });
    if (upErr) continue;

    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(imgPath);

    await supabase
      .from('products')
      .update({ image_url: urlData.publicUrl })
      .eq('id', productId);
    uploaded++;
  }

  return uploaded;
}

/**
 * EML取込の将来拡張ポイント。
 *
 * 現段階ではGmail/EML自体を安全に保管し、PDF/XLSX/XLS添付だけ既存取込へ流す。
 * EML単体やEML内のネスト添付展開は、ここに実装する。
 */
export async function handleImportEml(job: Job, supabase: Supabase): Promise<void> {
  if (job.quotation_id) {
    const { data: quotation, error: qErr } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', job.quotation_id)
      .single();
    if (qErr || !quotation) throw new Error(`Quotation not found: ${qErr?.message}`);

    const manifest = await readBundleManifest(supabase, quotation);
    const sources: WorkbookBundleSource[] = [];
    for (const file of manifest.files) {
      const buffer = await downloadStorageBuffer(supabase, 'quotation-files', file.storagePath);
      sources.push(await extractWorkbookSource(file.originalName, buffer));
    }

    const merged = mergeWorkbookBundle(sources);
    console.log(
      `[import-eml] 複数資料役割判定: ${merged.diagnostics.files
        .map((file) => `${file.fileName}:${file.role}(${file.productCount}件/${file.imageCount}画像)`)
        .join(', ')}`,
    );

    const totalProducts = merged.sheets.reduce((n, sheet) => n + sheet.products.length, 0);
    if (totalProducts === 0) {
      throw new Error('MULTI_FILE_IMPORT_EMPTY: 複数資料から商品を抽出できませんでした');
    }

    const settings = await loadSettings(supabase);
    const processedProducts = await processRawSheets(
      supabase,
      quotation.id,
      merged.sheets,
      settings,
      quotation.ai_background_enabled,
    );
    const uploaded = await uploadMergedProductImages(
      supabase,
      processedProducts,
      merged.productImages,
    );
    console.log(
      `[import-eml] 複数資料統合完了: products=${processedProducts.length} images=${uploaded}/${merged.productImages.length}`,
    );
    return;
  }

  if (!job.target_id) {
    console.log('[import-eml] target_id がないため保管のみで完了します。');
    return;
  }

  await supabase
    .from('gmail_estimate_files')
    .update({
      status: 'unsupported',
      error_message: 'EML内添付の自動展開は未実装です。保管済みファイルを確認してください。',
    })
    .eq('id', job.target_id);
}
