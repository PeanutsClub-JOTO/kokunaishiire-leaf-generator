/**
 * OCRプロンプトのバージョン管理
 *
 * DB (ocr_prompts) にアクティブプロンプトがあればそれを使い、
 * なければコード内のデフォルトプロンプトにフォールバックする。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';

type Supabase = SupabaseClient<Database>;

export const DEFAULT_SYSTEM_PROMPT = `
あなたは食品メーカーの見積書（帳票）から商品情報を正確に抽出するアシスタントです。

【重要ルール】
1. 「単価」列は仕入原価（原価）を意味します。上代（希望小売価格）とは別物です。
   単価 < 上代 となるのが正常です。逆転している場合は注意。
2. 商品番号は丸数字（①②③...⑫）で表記されます。数値に変換してください（①=1, ②=2...）。
3. 入数は "A×B" 形式（例: "15×4", "12×1"）で記載されます。
4. 最小ロットは "N甲" または "Nケース" で記載されます。
5. 販売期間は "YYYY.MM.DD〜YYYY.MM.DD" 形式です。
6. 賞味期間は日数で記載されます（例: "240日（240日）"）。
7. JAN/EAN/GTINは jan_code、商品コード・品番・メーカー品番・型番は product_code として抽出してください。
8. 確信が持てない項目は null にし、confidence を下げてください。
9. 商品データが存在しない行（空行）はスキップしてください。
`.trim();

export const DEFAULT_USER_PROMPT = '添付の見積書から、全商品の情報をJSONで抽出してください。';

export type OcrPromptConfig = {
  version: number;
  systemPrompt: string;
  userPrompt: string;
};

export async function getActivePrompt(supabase: Supabase): Promise<OcrPromptConfig> {
  const { data } = await supabase
    .from('ocr_prompts')
    .select('version, system_prompt, user_prompt')
    .eq('is_active', true)
    .maybeSingle();

  if (data) {
    return {
      version: data.version,
      systemPrompt: data.system_prompt,
      userPrompt: data.user_prompt,
    };
  }

  return {
    version: 0,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPrompt: DEFAULT_USER_PROMPT,
  };
}

export async function getActivePromptVersion(supabase: Supabase): Promise<number> {
  const prompt = await getActivePrompt(supabase);
  return prompt.version;
}

export async function saveNewPrompt(
  supabase: Supabase,
  config: {
    systemPrompt: string;
    userPrompt: string;
    tuningReason: string;
    regressionResult: Json;
  },
): Promise<number> {
  const { data: latest } = await supabase
    .from('ocr_prompts')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newVersion = (latest?.version ?? 0) + 1;

  // 既存のアクティブプロンプトを非アクティブに
  await supabase
    .from('ocr_prompts')
    .update({ is_active: false })
    .eq('is_active', true);

  await supabase.from('ocr_prompts').insert({
    version: newVersion,
    system_prompt: config.systemPrompt,
    user_prompt: config.userPrompt,
    is_active: true,
    tuning_reason: config.tuningReason,
    regression_result: config.regressionResult,
  });

  console.log(`[ocr-prompt] 新プロンプト v${newVersion} を有効化`);
  return newVersion;
}
