/**
 * PDFインポートハンドラ
 *
 * 1. pdfplumber でテキスト表を抽出
 * 2. 結果が空 or エラーなら Gemini 画像PDFフォールバック
 * 3. 抽出した生フィールドを normalizeRawProduct で全パース
 * 4. xlsx と共通の processRawSheets パイプラインに合流
 *    （グルーピング・サイジング・リーフ生成・注意フラグまで一括処理）
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';
import { extractPdfTables } from '../../lib/import/pdf-table';
import { extractFromImagePdf } from '../../lib/import/pdf-image-llm';
import {
  normalizeRawProduct,
  type RawProductRow,
  type RawSheetData,
} from '../../lib/import/xlsx-cells';
import { parseLooseNumber } from '../../lib/import/number';
import { loadSettings, processRawSheets } from './import-xlsx';
import { recordImportMetrics, maybeAddGoldenTest } from '../../lib/import/ocr-metrics';
import { getActivePrompt, getActivePromptVersion } from '../../lib/import/ocr-prompt-store';

type Supabase = SupabaseClient<Database>;
type Job = Database['public']['Tables']['jobs']['Row'];

// AI抽出の信頼度がこれ未満なら low_extract_conf フラグを立てる（仕様 v2.1 §9c）
const LOW_CONFIDENCE_THRESHOLD = 0.7;

// pdfplumber の table データを RawProductRow 配列に変換する。
// ヘッダー文字列で列を特定し、生フィールドを normalizeRawProduct で全パースする。
function tablesToRawRows(tables: string[][][]): RawProductRow[] {
  const rows: RawProductRow[] = [];
  if (tables.length === 0) return rows;

  for (const table of tables) {
    if (table.length < 2) continue;
    const header = table[0].map((h) => (h ?? '').trim());

    const colIndex = (aliases: string[]) =>
      header.findIndex((h) => aliases.some((a) => h.includes(a)));

    const noIdx       = colIndex(['No', 'NO', '番号']);
    const nameIdx     = colIndex(['品名', '商品名']);
    const makerIdx    = colIndex(['メーカー']);
    const specIdx     = colIndex(['規格', 'Spec']);
    const irisuIdx    = colIndex(['入数', '入れ数']);
    const minLotIdx   = colIndex(['最小ロット', '最小ﾛｯﾄ']);
    const costIdx     = colIndex(['単価', '原価', '仕入']);
    const retailIdx   = colIndex(['上代', '希望小売', '定価']);
    const janIdx      = colIndex(['JAN', 'EAN', 'GTIN']);
    const productCodeIdx = colIndex(['商品コード', '商品CD', '品番', '品目コード', '品コード', 'メーカー品番', '型番', '管理番号']);
    const shelfIdx    = colIndex(['賞味期間', '賞味期限', '消費期限']);
    const salesIdx    = colIndex(['販売期間', '取扱期間']);
    const noteIdx     = colIndex(['備考', '特記']);

    const cell = (row: string[], idx: number): string | null =>
      idx >= 0 ? (row[idx]?.trim() || null) : null;
    const num = (row: string[], idx: number): number | null => {
      if (idx < 0) return null;
      return parseLooseNumber(row[idx] ?? null);
    };

    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      const name = cell(row, nameIdx);
      if (!name) continue;

      rows.push(
        normalizeRawProduct({
          no: cell(row, noIdx),
          maker_name: cell(row, makerIdx),
          product_name: name,
          spec_raw: cell(row, specIdx),
          irisu_raw: cell(row, irisuIdx),
          min_lot_raw: cell(row, minLotIdx),
          retail_price: num(row, retailIdx),
          cost: num(row, costIdx),
          jan_code: cell(row, janIdx),
          product_code: cell(row, productCodeIdx),
          shelf_life_raw: cell(row, shelfIdx),
          sales_period_raw: cell(row, salesIdx),
          note: cell(row, noteIdx),
        }),
      );
    }
  }

  return rows;
}

export async function handleImportPdf(
  job: Job,
  supabase: Supabase,
  isImagePdf = false,
): Promise<void> {
  if (!job.quotation_id) throw new Error('job has no quotation_id');

  const { data: quotation, error: qErr } = await supabase
    .from('quotations')
    .select('*')
    .eq('id', job.quotation_id)
    .single();
  if (qErr || !quotation) throw new Error(`Quotation not found: ${qErr?.message}`);

  const storagePath = `quotations/${quotation.id}/${quotation.source_ref}`;
  const { data: blob, error: dlErr } = await supabase.storage
    .from('quotation-files')
    .download(storagePath);
  if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message}`);

  const buffer = Buffer.from(await blob.arrayBuffer());
  const settings = await loadSettings(supabase);

  let rawProducts: RawProductRow[] = [];
  let sheetName = quotation.source_ref ?? 'PDF取込';
  let makerName: string | null = null;
  let ocrConfidence: number | null = null;

  if (!isImagePdf) {
    // テキストPDF: pdfplumber で抽出を試みる
    const pdfResult = await extractPdfTables(buffer);
    if (!pdfResult.error && pdfResult.pages.length > 0) {
      const allTables = pdfResult.pages.flatMap((p) => p.tables);
      rawProducts = tablesToRawRows(allTables);
    }
  }

  // 結果が空 or 画像PDF: Gemini にフォールバック
  if (rawProducts.length === 0) {
    const base64 = buffer.toString('base64');
    const activePrompt = await getActivePrompt(supabase);
    const llmResult = await extractFromImagePdf(base64, 'application/pdf', {
      systemPrompt: activePrompt.systemPrompt,
      userPrompt: activePrompt.userPrompt,
    });

    sheetName = `${sheetName}（AI抽出）`;
    makerName = llmResult.products[0]?.maker_name ?? null;
    ocrConfidence = llmResult.confidence;

    const lowConfidence = llmResult.confidence < LOW_CONFIDENCE_THRESHOLD;

    rawProducts = llmResult.products
      .filter((p) => p.product_name)
      .map((p) => {
        const row = normalizeRawProduct({
          no: p.no ?? null,
          maker_name: p.maker_name ?? makerName,
          product_name: p.product_name ?? '',
          spec_raw: p.spec_raw ?? null,
          irisu_raw: p.irisu_raw ?? null,
          min_lot_raw: p.min_lot_raw ?? null,
          retail_price: p.retail_price ?? null,
          cost: p.cost ?? null,
          jan_code: p.jan_code ?? null,
          product_code: p.product_code ?? null,
          shelf_life_raw: p.shelf_life_raw ?? null,
          sales_period_raw: p.sales_period_raw ?? null,
          note: p.note ?? null,
        });
        // 低信頼度は商品単位のフラグとして付与（target_id が実在の商品IDになる）
        if (lowConfidence) row.parse_errors.push('low_extract_conf');
        return row;
      });
  }

  if (rawProducts.length === 0) {
    console.warn('[import-pdf] No products extracted, marking done with warning');
    await recordImportMetrics(supabase, {
      jobId: job.id,
      quotationId: quotation.id,
      sourceType: 'pdf',
      ocrConfidence: 0,
      promptVersion: await getActivePromptVersion(supabase),
      rawSheets: [],
      errorMessage: 'No products extracted',
    }).catch((e) => console.warn('[import-pdf] メトリクス記録失敗:', e));
    return;
  }

  // xlsx と同一の共通パイプラインに合流（グルーピング・サイジング・リーフ生成）
  const sheet: RawSheetData = {
    sheet_name: sheetName,
    maker_name: makerName ?? rawProducts[0]?.maker_name ?? null,
    products: rawProducts,
  };
  await processRawSheets(supabase, quotation.id, [sheet], settings, quotation.ai_background_enabled);

  // メトリクス記録 + ゴールデンテスト保存（失敗しても本処理は続行）
  const promptVersion = await getActivePromptVersion(supabase);
  await recordImportMetrics(supabase, {
    jobId: job.id,
    quotationId: quotation.id,
    sourceType: 'pdf',
    ocrConfidence: ocrConfidence,
    promptVersion,
    rawSheets: [sheet],
  }).catch((e) => console.warn('[import-pdf] メトリクス記録失敗:', e));

  if (ocrConfidence !== null && ocrConfidence > 0) {
    await maybeAddGoldenTest(supabase, {
      quotationId: quotation.id,
      jobId: job.id,
      ocrConfidence,
      rawProducts,
      fileStoragePath: storagePath,
      fileMimeType: 'application/pdf',
      makerName,
    }).catch((e) => console.warn('[import-pdf] ゴールデンテスト保存失敗:', e));
  }
}
