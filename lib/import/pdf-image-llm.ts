/**
 * 画像PDF/崩れ帳票 — Gemini構造化抽出 (仕様書 v2.1 §9c)
 *
 * JSON Schema を固定し、LLM_MODEL に画像（base64）+スキーマを渡して
 * 商品情報を構造化抽出する。
 * 信頼度スコアが 0.7 未満の場合は low_extract_conf フラグを立てる。
 */
import { getGeminiClient } from '../llm/gemini';
import { timeoutMsFromEnv, withTimeout } from '../async/timeout';

export type RawProductFromLlm = {
  no: number | null;
  maker_name: string | null;
  product_name: string | null;
  spec_raw: string | null;
  irisu_raw: string | null;
  min_lot_raw: string | null;
  retail_price: number | null;
  cost: number | null;
  jan_code: string | null;
  shelf_life_raw: string | null;
  sales_period_raw: string | null;
  note: string | null;
};

export type LlmExtractResult = {
  confidence: number;       // 0.0〜1.0。0.7未満で low_extract_conf
  products: RawProductFromLlm[];
  raw_response: string;
};

// JSON Schema（Gemini responseSchema 形式）
const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    confidence: {
      type: 'number',
      description:
        '抽出の信頼度スコア。全項目が正確に読み取れた場合は1.0、不明確な部分がある場合は低い値',
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'number', description: '商品番号（①=1, ②=2, ..., ⑫=12）' },
          maker_name: { type: 'string', description: 'メーカー名' },
          product_name: { type: 'string', description: '品名' },
          spec_raw: { type: 'string', description: '規格（例: "6個", "125g"）' },
          irisu_raw: { type: 'string', description: '入数（例: "15×4", "12×1"）' },
          min_lot_raw: { type: 'string', description: '最小ロット（例: "1甲", "1ケース"）' },
          retail_price: { type: 'number', description: '上代（希望小売価格）' },
          cost: {
            type: 'number',
            description:
              '単価＝仕入原価（注意: "単価"列は原価を意味する。上代より必ず小さい）',
          },
          jan_code: { type: 'string', description: 'JANコード' },
          shelf_life_raw: {
            type: 'string',
            description: '賞味期間（例: "240日（240日）"）',
          },
          sales_period_raw: {
            type: 'string',
            description: '販売期間（例: "2026.04.17〜2026.07.31"）',
          },
          note: { type: 'string', description: '備考' },
        },
      },
    },
  },
  required: ['confidence', 'products'],
};

const SYSTEM_PROMPT = `
あなたは食品メーカーの見積書（帳票）から商品情報を正確に抽出するアシスタントです。

【重要ルール】
1. 「単価」列は仕入原価（原価）を意味します。上代（希望小売価格）とは別物です。
   単価 < 上代 となるのが正常です。逆転している場合は注意。
2. 商品番号は丸数字（①②③...⑫）で表記されます。数値に変換してください（①=1, ②=2...）。
3. 入数は "A×B" 形式（例: "15×4", "12×1"）で記載されます。
4. 最小ロットは "N甲" または "Nケース" で記載されます。
5. 販売期間は "YYYY.MM.DD〜YYYY.MM.DD" 形式です。
6. 賞味期間は日数で記載されます（例: "240日（240日）"）。
7. 確信が持てない項目は null にし、confidence を下げてください。
8. 商品データが存在しない行（空行）はスキップしてください。
`.trim();

/**
 * 画像PDF（またはPDFを画像変換したもの）から商品情報をGeminiで抽出する
 *
 * @param imageBase64 base64エンコードされた画像データ
 * @param mimeType 画像のMIMEタイプ
 */
export async function extractFromImagePdf(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' = 'image/jpeg',
): Promise<LlmExtractResult> {
  const client = getGeminiClient();

  const result = await withTimeout(
    client.generate(
      '添付の見積書から、全商品の情報をJSONで抽出してください。',
      {
        systemPrompt: SYSTEM_PROMPT,
        images: [{ mimeType, data: imageBase64 }],
        responseSchema: PRODUCT_SCHEMA,
        temperature: 0.1, // 低温で確実な抽出
      },
    ),
    timeoutMsFromEnv('PDF_OCR_TIMEOUT_MS', 90_000),
    'Gemini PDF OCR',
  );

  const parsed = result.parsed as { confidence: number; products: RawProductFromLlm[] } | undefined;

  if (!parsed) {
    return {
      confidence: 0,
      products: [],
      raw_response: result.text,
    };
  }

  return {
    confidence: parsed.confidence ?? 0,
    products: parsed.products ?? [],
    raw_response: result.text,
  };
}
