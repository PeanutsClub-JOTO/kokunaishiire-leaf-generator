/**
 * アソート補助判定 — Gemini (仕様書 v2.1 §7.2)
 *
 * 4項目一致グループに対し、品名から味違い・種類違いとして
 * 自然に詰め合わせられるかを補助判定する。
 * 違和感があれば weak_variant フラグを立て、グルーピングは維持。
 */
import { getGeminiClient } from '../llm/gemini';

export type AssortVariantCheckResult = {
  isNaturalVariant: boolean;   // true: 詰め合わせとして自然
  confidence: number;          // 0.0〜1.0
  reason: string;              // 判断理由
};

const SYSTEM_PROMPT = `
あなたは食品の詰め合わせ（アソート）企画の専門家です。
複数の商品が「同じメーカーの味違い・種類違いとして自然に詰め合わせられるか」を判断します。

判断基準:
- 同じカテゴリの味違い（例: 塩レモン味・ヨーグルト味・水羊羹味）→ 詰め合わせに適している
- 全く異なる食品ジャンル（例: せんべいとゼリー）→ 不自然
- 形状や食感が大きく異なる（例: 飴とケーキ）→ 不自然

出力はJSON形式で、isNaturalVariant（真偽値）、confidence（0.0〜1.0）、reason（理由）を返してください。
`.trim();

/**
 * 商品名リストから詰め合わせの妥当性を判定する
 *
 * @param productNames 同グループの商品名リスト
 */
export async function checkVariantCompatibility(
  productNames: string[],
): Promise<AssortVariantCheckResult> {
  if (productNames.length < 2) {
    return { isNaturalVariant: true, confidence: 1.0, reason: '単品のため判定不要' };
  }

  const client = getGeminiClient();
  const nameList = productNames.map((n, i) => `${i + 1}. ${n}`).join('\n');

  const result = await client.generate(
    `以下の商品名が詰め合わせとして自然かどうか判断してください:\n${nameList}`,
    {
      systemPrompt: SYSTEM_PROMPT,
      responseSchema: {
        type: 'object',
        properties: {
          isNaturalVariant: { type: 'boolean' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['isNaturalVariant', 'confidence', 'reason'],
      },
      temperature: 0.2,
    },
  );

  const parsed = result.parsed as AssortVariantCheckResult | undefined;

  if (!parsed) {
    return {
      isNaturalVariant: true,
      confidence: 0.5,
      reason: 'AI判定不能のためデフォルト通過',
    };
  }

  return parsed;
}
