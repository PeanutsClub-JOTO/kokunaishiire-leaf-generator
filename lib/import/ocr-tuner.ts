/**
 * OCRプロンプト自動チューニングエンジン
 *
 * 精度低下を検知すると:
 * 1. 失敗/低精度インポートを多角的に分析
 * 2. Geminiに改善プロンプトを生成させる
 * 3. ゴールデンテストで回帰テストを実行
 * 4. 合格した場合のみ新プロンプトを有効化
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { getGeminiClient } from '@/lib/llm/gemini';
import { extractFromImagePdf, type RawProductFromLlm } from './pdf-image-llm';
import { normalizeRawProduct, type RawProductRow } from './xlsx-cells';
import {
  getActivePrompt,
  saveNewPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT,
  type OcrPromptConfig,
} from './ocr-prompt-store';

type Supabase = SupabaseClient<Database>;

// ──── 設定定数 ────
const LOOKBACK_HOURS = 72;
const MIN_RECENT_IMPORTS = 3;
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const HIGH_ERROR_RATE_THRESHOLD = 0.3;
const DEGRADATION_RATIO = 0.5;
const REGRESSION_TOLERANCE = 0.15;

export type TuneCheckResult = {
  shouldTune: boolean;
  reason: string;
  recentMetrics: RecentMetricSummary[];
};

type RecentMetricSummary = {
  jobId: string | null;
  confidence: number | null;
  fieldFillRate: number | null;
  parseErrorRate: number | null;
  productCount: number;
};

type GoldenTestCase = {
  id: string;
  fileStoragePath: string;
  fileMimeType: string;
  expectedProducts: GoldenProduct[];
  expectedConfidence: number;
  productCount: number;
};

type GoldenProduct = {
  no: number | null;
  product_name: string | null;
  cost: number | null;
  retail_price: number | null;
  case_qty: number | null;
};

/**
 * 精度低下が発生しているかチェックする
 */
export async function checkAccuracyDegradation(
  supabase: Supabase,
): Promise<TuneCheckResult> {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from('import_metrics')
    .select('job_id, ocr_confidence, field_fill_rate, parse_error_rate, product_count')
    .gte('created_at', cutoff)
    .not('ocr_confidence', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const metrics: RecentMetricSummary[] = (recent ?? []).map((r) => ({
    jobId: r.job_id,
    confidence: r.ocr_confidence,
    fieldFillRate: r.field_fill_rate,
    parseErrorRate: r.parse_error_rate,
    productCount: r.product_count,
  }));

  if (metrics.length < MIN_RECENT_IMPORTS) {
    return {
      shouldTune: false,
      reason: `直近${LOOKBACK_HOURS}時間のOCRインポートが${metrics.length}件で閾値${MIN_RECENT_IMPORTS}件未満`,
      recentMetrics: metrics,
    };
  }

  const lowConfCount = metrics.filter(
    (m) => m.confidence !== null && m.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const highErrorCount = metrics.filter(
    (m) => m.parseErrorRate !== null && m.parseErrorRate > HIGH_ERROR_RATE_THRESHOLD,
  ).length;
  const zeroProductCount = metrics.filter((m) => m.productCount === 0).length;

  const degradedCount = lowConfCount + highErrorCount + zeroProductCount;
  const degradationRatio = degradedCount / metrics.length;

  if (degradationRatio >= DEGRADATION_RATIO) {
    return {
      shouldTune: true,
      reason: `直近${metrics.length}件中${degradedCount}件が低精度（低confidence=${lowConfCount}, 高エラー率=${highErrorCount}, 抽出0件=${zeroProductCount}）`,
      recentMetrics: metrics,
    };
  }

  // 連続失敗チェック: 直近3件が連続して低精度
  const last3 = metrics.slice(0, 3);
  const consecutiveBad = last3.every(
    (m) =>
      (m.confidence !== null && m.confidence < LOW_CONFIDENCE_THRESHOLD) ||
      (m.parseErrorRate !== null && m.parseErrorRate > HIGH_ERROR_RATE_THRESHOLD) ||
      m.productCount === 0,
  );

  if (consecutiveBad && last3.length >= 3) {
    return {
      shouldTune: true,
      reason: `直近3件が連続して低精度: ${last3.map((m) => `conf=${m.confidence?.toFixed(2)}, errRate=${m.parseErrorRate?.toFixed(2)}, products=${m.productCount}`).join(' / ')}`,
      recentMetrics: metrics,
    };
  }

  return {
    shouldTune: false,
    reason: `精度は正常範囲内（劣化率=${(degradationRatio * 100).toFixed(0)}%）`,
    recentMetrics: metrics,
  };
}

/**
 * 失敗したインポートを分析し、改善プロンプトを生成する
 */
async function analyzeFailuresAndGeneratePrompt(
  supabase: Supabase,
  currentPrompt: OcrPromptConfig,
  recentMetrics: RecentMetricSummary[],
): Promise<{ systemPrompt: string; userPrompt: string; analysis: string } | null> {
  // 低精度だったジョブの詳細を取得
  const badJobIds = recentMetrics
    .filter(
      (m) =>
        m.jobId &&
        ((m.confidence !== null && m.confidence < LOW_CONFIDENCE_THRESHOLD) ||
          (m.parseErrorRate !== null && m.parseErrorRate > HIGH_ERROR_RATE_THRESHOLD) ||
          m.productCount === 0),
    )
    .map((m) => m.jobId!)
    .slice(0, 5);

  if (badJobIds.length === 0) return null;

  // 失敗ジョブのエラー詳細を取得
  const { data: failedMetrics } = await supabase
    .from('import_metrics')
    .select('*')
    .in('job_id', badJobIds);

  // パースエラーの傾向を集計
  const errorTrends: Record<string, number> = {};
  for (const m of failedMetrics ?? []) {
    const errors = (m.parse_errors ?? {}) as Record<string, number>;
    for (const [errType, count] of Object.entries(errors)) {
      errorTrends[errType] = (errorTrends[errType] ?? 0) + (count as number);
    }
  }

  const analysisContext = `
## 現在のプロンプト（バージョン ${currentPrompt.version}）
### システムプロンプト:
${currentPrompt.systemPrompt}

### ユーザープロンプト:
${currentPrompt.userPrompt}

## 直近のインポート結果（精度低下検出）
${recentMetrics
  .slice(0, 10)
  .map(
    (m, i) =>
      `${i + 1}. confidence=${m.confidence?.toFixed(2) ?? 'N/A'}, field_fill=${m.fieldFillRate?.toFixed(2) ?? 'N/A'}, parse_err_rate=${m.parseErrorRate?.toFixed(2) ?? 'N/A'}, products=${m.productCount}`,
  )
  .join('\n')}

## パースエラーの傾向
${Object.entries(errorTrends)
  .sort(([, a], [, b]) => b - a)
  .map(([type, count]) => `- ${type}: ${count}件`)
  .join('\n') || '（エラーなし）'}

## 失敗した見積書の特徴
${(failedMetrics ?? [])
  .map((m) => `- source=${m.source_type}, products=${m.product_count}, error=${m.error_message ?? 'なし'}`)
  .join('\n')}
`.trim();

  const client = getGeminiClient();
  const result = await client.generate(
    `${analysisContext}

上記の分析結果を元に、以下の2点を回答してください:

1. **失敗分析**: なぜ読み取り精度が低下しているのかの分析（箇条書き3-5点）
2. **改善プロンプト**: 精度を改善するための新しいシステムプロンプトとユーザープロンプト

改善プロンプトは以下のJSON形式で出力してください:
\`\`\`json
{
  "analysis": "失敗分析の要約（日本語）",
  "system_prompt": "改善されたシステムプロンプト全文",
  "user_prompt": "改善されたユーザープロンプト全文"
}
\`\`\`

注意:
- 既存のルール（単価=原価、丸数字変換など）は削除しないこと
- 新しい見積書フォーマットへの対応力を上げつつ、既存フォーマットの読取りを壊さないこと
- プロンプトが長くなりすぎないこと（2000文字以内）`,
    {
      systemPrompt: 'あなたはOCRシステムのプロンプトエンジニアです。見積書抽出の精度改善が専門です。',
      temperature: 0.3,
    },
  );

  try {
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]) as {
      analysis: string;
      system_prompt: string;
      user_prompt: string;
    };

    if (!parsed.system_prompt || !parsed.user_prompt) return null;
    if (parsed.system_prompt.length > 3000) return null;

    return {
      systemPrompt: parsed.system_prompt,
      userPrompt: parsed.user_prompt,
      analysis: parsed.analysis,
    };
  } catch {
    console.warn('[ocr-tuner] プロンプト生成結果のパースに失敗');
    return null;
  }
}

/**
 * ゴールデンテストで回帰テストを実行する
 *
 * 新プロンプトで既存の成功ケースが壊れないことを確認する。
 * 商品名・原価の一致率で判定。
 */
async function runRegressionTests(
  supabase: Supabase,
  newPrompt: { systemPrompt: string; userPrompt: string },
): Promise<{
  passed: boolean;
  details: Array<{
    testId: string;
    productCount: number;
    matchRate: number;
    passed: boolean;
  }>;
}> {
  const { data: tests } = await supabase
    .from('ocr_golden_tests')
    .select('*')
    .eq('is_active', true)
    .limit(10);

  if (!tests || tests.length === 0) {
    console.log('[ocr-tuner] ゴールデンテストなし → 回帰テストスキップ（合格扱い）');
    return { passed: true, details: [] };
  }

  const details: Array<{
    testId: string;
    productCount: number;
    matchRate: number;
    passed: boolean;
  }> = [];

  for (const test of tests) {
    try {
      const { data: fileBlob } = await supabase.storage
        .from('quotation-files')
        .download(test.file_storage_path);

      if (!fileBlob) {
        console.warn(`[ocr-tuner] ゴールデンテスト ${test.id} のファイル取得に失敗（スキップ）`);
        continue;
      }

      const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');
      const result = await extractFromImagePdf(
        base64,
        test.file_mime_type as 'application/pdf',
        newPrompt,
      );

      const expected = (test.expected_products as GoldenProduct[]) ?? [];
      const actual = result.products;

      const matchRate = computeMatchRate(expected, actual);
      const testPassed = matchRate >= (1 - REGRESSION_TOLERANCE);

      details.push({
        testId: test.id,
        productCount: test.product_count,
        matchRate,
        passed: testPassed,
      });

      console.log(
        `[ocr-tuner] 回帰テスト ${test.id}: match=${(matchRate * 100).toFixed(0)}% ${testPassed ? '✓' : '✗'}`,
      );
    } catch (err) {
      console.warn(`[ocr-tuner] 回帰テスト ${test.id} 実行エラー:`, err);
      details.push({
        testId: test.id,
        productCount: test.product_count,
        matchRate: 0,
        passed: false,
      });
    }
  }

  const allPassed = details.length === 0 || details.every((d) => d.passed);
  return { passed: allPassed, details };
}

/**
 * 期待値と実際の抽出結果の一致率を計算する。
 * 商品名の一致と、主要数値フィールドの近似一致で判定。
 */
function computeMatchRate(expected: GoldenProduct[], actual: RawProductFromLlm[]): number {
  if (expected.length === 0) return 1;

  let matched = 0;
  for (const exp of expected) {
    const found = actual.find((a) => {
      if (!exp.product_name || !a.product_name) return false;
      const nameMatch =
        a.product_name.includes(exp.product_name) ||
        exp.product_name.includes(a.product_name) ||
        normalize(a.product_name) === normalize(exp.product_name);
      if (!nameMatch) return false;

      if (exp.cost !== null && a.cost !== null) {
        if (Math.abs(exp.cost - a.cost) / Math.max(exp.cost, 1) > 0.05) return false;
      }
      return true;
    });
    if (found) matched++;
  }

  return matched / expected.length;
}

function normalize(s: string): string {
  return s
    .replace(/[\s　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .toLowerCase();
}

/**
 * チューニングメインフロー
 *
 * 1. 精度低下検知
 * 2. 失敗分析 + 改善プロンプト生成
 * 3. ゴールデンテストで回帰テスト
 * 4. 合格なら新プロンプト有効化
 */
export async function runAutoTuning(
  supabase: Supabase,
): Promise<{
  tuned: boolean;
  reason: string;
  newVersion?: number;
}> {
  const check = await checkAccuracyDegradation(supabase);
  if (!check.shouldTune) {
    return { tuned: false, reason: check.reason };
  }

  console.log(`[ocr-tuner] チューニング開始: ${check.reason}`);

  const currentPrompt = await getActivePrompt(supabase);
  const candidate = await analyzeFailuresAndGeneratePrompt(
    supabase,
    currentPrompt,
    check.recentMetrics,
  );

  if (!candidate) {
    const logEntry = {
      trigger_reason: check.reason,
      analyzed_job_ids: check.recentMetrics
        .filter((m) => m.jobId)
        .map((m) => m.jobId!),
      regression_passed: null,
      prompt_adopted: false,
      analysis_summary: '改善プロンプトの生成に失敗',
    };
    await supabase.from('ocr_tune_logs').insert(logEntry);
    return { tuned: false, reason: '改善プロンプトの生成に失敗' };
  }

  console.log(`[ocr-tuner] 改善プロンプト生成完了、回帰テスト実行中...`);

  const regression = await runRegressionTests(supabase, {
    systemPrompt: candidate.systemPrompt,
    userPrompt: candidate.userPrompt,
  });

  const analyzedJobIds = check.recentMetrics
    .filter((m) => m.jobId)
    .map((m) => m.jobId!);

  if (!regression.passed) {
    const logEntry = {
      trigger_reason: check.reason,
      analyzed_job_ids: analyzedJobIds,
      regression_passed: false,
      regression_details: regression.details,
      prompt_adopted: false,
      analysis_summary: `回帰テスト不合格: ${regression.details.filter((d) => !d.passed).length}件失敗。${candidate.analysis}`,
    };
    await supabase.from('ocr_tune_logs').insert(logEntry);
    console.warn('[ocr-tuner] 回帰テスト不合格 → プロンプト不採用');
    return { tuned: false, reason: '回帰テスト不合格: 既存の見積書読取りに悪影響があるため不採用' };
  }

  // 回帰テスト合格 → 新プロンプト有効化
  const newVersion = await saveNewPrompt(supabase, {
    systemPrompt: candidate.systemPrompt,
    userPrompt: candidate.userPrompt,
    tuningReason: `${check.reason}\n\n分析: ${candidate.analysis}`,
    regressionResult: { passed: true, details: regression.details } as unknown as import('@/lib/supabase/types').Json,
  });

  const logEntry = {
    trigger_reason: check.reason,
    analyzed_job_ids: analyzedJobIds,
    new_prompt_version: newVersion,
    regression_passed: true,
    regression_details: regression.details,
    prompt_adopted: true,
    analysis_summary: candidate.analysis,
  };
  await supabase.from('ocr_tune_logs').insert(logEntry);

  console.log(`[ocr-tuner] チューニング完了: 新プロンプト v${newVersion} を有効化`);
  return { tuned: true, reason: candidate.analysis, newVersion };
}
