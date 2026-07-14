/**
 * OCRインポート精度メトリクスの記録・ゴールデンテスト保存
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { RawProductRow, RawSheetData } from './xlsx-cells';

type Supabase = SupabaseClient<Database>;

const IMPORTANT_FIELDS = [
  'product_name', 'cost', 'retail_price', 'case_qty',
  'shelf_life_days', 'spec_pieces', 'jan_code',
] as const;

const GOLDEN_TEST_CONFIDENCE_THRESHOLD = 0.8;
const GOLDEN_TEST_ERROR_RATE_THRESHOLD = 0.1;
const GOLDEN_TEST_MAX_COUNT = 30;

export type MetricsInput = {
  jobId: string;
  quotationId: string;
  sourceType: string;
  ocrConfidence?: number | null;
  promptVersion?: number | null;
  rawSheets: RawSheetData[];
  errorMessage?: string | null;
};

function computeFieldFillRate(products: RawProductRow[]): number {
  if (products.length === 0) return 0;
  let filled = 0;
  let total = 0;
  for (const p of products) {
    for (const field of IMPORTANT_FIELDS) {
      total++;
      if (p[field] !== null && p[field] !== undefined) filled++;
    }
  }
  return total > 0 ? filled / total : 0;
}

function computeParseErrorRate(products: RawProductRow[]): {
  rate: number;
  errors: Record<string, number>;
} {
  if (products.length === 0) return { rate: 0, errors: {} };
  const errorCounts: Record<string, number> = {};
  let totalErrors = 0;
  for (const p of products) {
    for (const err of p.parse_errors) {
      errorCounts[err] = (errorCounts[err] ?? 0) + 1;
      totalErrors++;
    }
  }
  return {
    rate: totalErrors / products.length,
    errors: errorCounts,
  };
}

export async function recordImportMetrics(
  supabase: Supabase,
  input: MetricsInput,
): Promise<void> {
  const allProducts = input.rawSheets.flatMap((s) => s.products);
  const productCount = allProducts.length;
  const fieldFillRate = computeFieldFillRate(allProducts);
  const { rate: parseErrorRate, errors: parseErrors } = computeParseErrorRate(allProducts);

  await supabase.from('import_metrics').insert({
    job_id: input.jobId,
    quotation_id: input.quotationId,
    source_type: input.sourceType,
    ocr_confidence: input.ocrConfidence ?? null,
    prompt_version: input.promptVersion ?? null,
    field_fill_rate: fieldFillRate,
    parse_error_rate: parseErrorRate,
    product_count: productCount,
    parse_errors: parseErrors,
    error_message: input.errorMessage ?? null,
  });
}

export async function maybeAddGoldenTest(
  supabase: Supabase,
  input: {
    quotationId: string;
    jobId: string;
    ocrConfidence: number;
    rawProducts: RawProductRow[];
    fileStoragePath: string;
    fileMimeType: string;
    makerName?: string | null;
  },
): Promise<void> {
  const { rate } = computeParseErrorRate(input.rawProducts);
  if (
    input.ocrConfidence < GOLDEN_TEST_CONFIDENCE_THRESHOLD ||
    rate > GOLDEN_TEST_ERROR_RATE_THRESHOLD ||
    input.rawProducts.length === 0
  ) {
    return;
  }

  const { count } = await supabase
    .from('ocr_golden_tests')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if ((count ?? 0) >= GOLDEN_TEST_MAX_COUNT) return;

  const expectedProducts = input.rawProducts.map((p) => ({
    no: p.no,
    maker_name: p.maker_name,
    product_name: p.product_name,
    spec_raw: p.spec_raw,
    cost: p.cost,
    retail_price: p.retail_price,
    case_qty: p.case_qty,
    shelf_life_days: p.shelf_life_days,
    jan_code: p.jan_code,
  }));

  await supabase.from('ocr_golden_tests').insert({
    source_quotation_id: input.quotationId,
    source_job_id: input.jobId,
    file_storage_path: input.fileStoragePath,
    file_mime_type: input.fileMimeType,
    expected_products: expectedProducts,
    expected_confidence: input.ocrConfidence,
    maker_name: input.makerName ?? null,
    product_count: input.rawProducts.length,
  });

  console.log(`[ocr-metrics] ゴールデンテスト追加 (quotation=${input.quotationId}, products=${input.rawProducts.length})`);
}
