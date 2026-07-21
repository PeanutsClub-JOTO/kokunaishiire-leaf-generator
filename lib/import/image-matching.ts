/**
 * Excel埋め込み画像 → 商品 の対応付け
 *
 * 位置ヒューリスティック（No.番目 / 最近接行 等）は廃止。以下の2段構え。
 *
 * 1) 決定論マッチ: 画像アンカー周辺の少数セル文字列（nearbyText）に
 *    商品表の JAN / 商品コード / 品名の特徴部分 / 上代 が現れるかで一意に決める。
 * 2) LLMマッチ: 決定論で確定しなかった画像は、画像そのものを Gemini に渡して
 *    候補商品リストから内容一致するものを選ばせる。
 */
import type { ExtractedImage } from './xlsx-images';
import { getGeminiClient } from '../llm/gemini';
import { withTimeout, timeoutMsFromEnv } from '../async/timeout';

export type ProductImageTarget = {
  id: string;
  sheetName: string | null;
  janCode?: string | null;
  productCode?: string | null;
  productName?: string | null;
  makerName?: string | null;
  specRaw?: string | null;
  retailPrice?: number | null;
  cost?: number | null;
};

export type ProductImageMatch = {
  productId: string;
  reason: 'jan' | 'product_code' | 'product_name' | 'price' | 'llm_vision';
  confidence: number;
};

export type MatchOptions = {
  excludeProductIds?: ReadonlySet<string>;
  /** LLM フォールバックを許可するか（テスト等で無効化できる） */
  enableLlmFallback?: boolean;
  /** LLM 候補上限（トークン制御用） */
  maxLlmCandidates?: number;
};

/** 全角→半角・空白除去。JAN/コード比較用。 */
function normalizeCompact(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　\-‐-‒–—―ー_・.,、。／/\\()（）\[\]【】]/g, '')
    .toLowerCase();
}

/** 商品名の突合用: 記号は落とし小文字化するが文字は残す。 */
function normalizeLoose(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

/** 数値だけ抜き出したもの（価格突合用）。 */
function normalizeDigits(s: string): string {
  return s.normalize('NFKC').replace(/[^\d]/g, '');
}

/**
 * 品名から「特徴的な substring」を作る。
 * 例: "ゴールドＰ 北アルプス清らか天然水和梨水" → "北アルプス清らか天然水和梨水"
 * ヘッダ的な短い共通接頭辞（"ゴールドP"等）を無視して、
 * 6文字以上の連続した固有名詞相当を優先的に返す。
 */
function characteristicSubstrings(name: string): string[] {
  const norm = normalizeLoose(name);
  const results = new Set<string>();
  // 6文字以上のスライディングウィンドウ（先頭/末尾を優先）
  if (norm.length >= 6) results.add(norm);
  // 中央部の 6〜10 文字も候補に
  for (const len of [10, 8, 6]) {
    if (norm.length >= len) {
      results.add(norm.slice(0, len));
      results.add(norm.slice(-len));
    }
  }
  return [...results].filter((s) => s.length >= 6);
}

function sameSheetCandidates(
  image: Pick<ExtractedImage, 'sheetName'>,
  products: ProductImageTarget[],
): ProductImageTarget[] {
  if (!image.sheetName) return products;
  const matched = products.filter((p) => p.sheetName === image.sheetName);
  return matched.length > 0 ? matched : products;
}

type Hit = { product: ProductImageTarget; reason: ProductImageMatch['reason']; score: number };

/**
 * nearbyText × 商品情報 の決定論マッチ。
 * スコアの高い順・単独ヒットなら確定として返す。
 * 複数商品が同点でヒットした場合は null（LLM に委ねる）。
 */
function deterministicMatch(
  image: ExtractedImage,
  products: ProductImageTarget[],
): ProductImageMatch | null {
  const nearbyCompact = normalizeCompact(image.nearbyText);
  const nearbyLoose = normalizeLoose(image.nearbyText);
  const nearbyDigits = normalizeDigits(image.nearbyText);

  const hits = new Map<string, Hit>();
  const pushHit = (
    product: ProductImageTarget,
    reason: ProductImageMatch['reason'],
    score: number,
  ) => {
    const existing = hits.get(product.id);
    if (!existing || existing.score < score) {
      hits.set(product.id, { product, reason, score });
    }
  };

  for (const product of products) {
    // JAN（13桁想定）: 完全一致で最強シグナル
    if (product.janCode) {
      const jan = normalizeCompact(product.janCode);
      if (jan.length >= 8 && nearbyCompact.includes(jan)) {
        pushHit(product, 'jan', 100);
      }
    }

    // 商品コード / 品番: 5文字以上のもののみ（"3820466" 等）
    if (product.productCode) {
      const code = normalizeCompact(product.productCode);
      if (code.length >= 5 && nearbyCompact.includes(code)) {
        pushHit(product, 'product_code', 80);
      }
    }

    // 品名の特徴部分
    if (product.productName) {
      for (const sub of characteristicSubstrings(product.productName)) {
        if (nearbyLoose.includes(sub)) {
          pushHit(product, 'product_name', 60 + Math.min(sub.length, 20));
          break;
        }
      }
    }

    // 上代（弱シグナル: 単独では確定させない補助情報）
    if (product.retailPrice && product.retailPrice > 0) {
      const priceDigits = String(product.retailPrice);
      if (priceDigits.length >= 3 && nearbyDigits.includes(priceDigits)) {
        pushHit(product, 'price', 20);
      }
    }
  }

  if (hits.size === 0) return null;

  const sorted = [...hits.values()].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const runnerUp = sorted[1];

  // 上位が明確に上回っている（弱シグナルpriceだけの並びを除く）場合のみ確定
  if (top.score < 40) return null; // price(20) だけでは決めない
  if (runnerUp && runnerUp.score >= top.score) return null; // 同点は決められない
  return {
    productId: top.product.id,
    reason: top.reason,
    confidence: top.score >= 80 ? 0.95 : 0.8,
  };
}

const LLM_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    product_id: {
      type: 'string',
      description:
        '画像に写っている商品の product_id。候補リストから正確に選ぶこと。判別不能なら空文字。',
    },
    confidence: {
      type: 'number',
      description: '一致度 0.0〜1.0。ロゴ・装飾・判別不能な場合は 0.3 未満にする。',
    },
    reasoning: { type: 'string', description: '短い判断理由（デバッグ用）' },
  },
  required: ['product_id', 'confidence'],
};

const LLM_MATCH_SYSTEM_PROMPT = `あなたは食品カタログの画像アノテーターです。
渡された画像1枚と、候補商品リスト（product_id, 品名, 規格, メーカー, JAN）を突き合わせ、
画像が最もよく表している商品を1つ選び product_id を返してください。
- パッケージ表面の商品名・キャラクター・味・容量が最重要の手がかりです。
- どの候補にも該当しない（企業ロゴ・装飾等）場合は product_id を空文字にし、confidence を 0.2 以下にしてください。`;

async function llmVisionMatch(
  image: ExtractedImage,
  candidates: ProductImageTarget[],
  maxCandidates: number,
): Promise<ProductImageMatch | null> {
  if (candidates.length === 0) return null;
  const limited = candidates.slice(0, maxCandidates);
  const candidateBlock = limited
    .map(
      (p, i) =>
        `${i + 1}. product_id="${p.id}" 品名="${p.productName ?? ''}" 規格="${p.specRaw ?? ''}" メーカー="${p.makerName ?? ''}" JAN="${p.janCode ?? ''}"`,
    )
    .join('\n');
  const userPrompt = `以下は同一見積書内の候補商品一覧です。渡された画像の内容と最も合致するものを1つ選んでください。\n\n${candidateBlock}\n\n判別できない場合は product_id を空文字にしてください。`;

  const client = getGeminiClient();
  const base64 = image.buffer.toString('base64');
  const mime =
    image.mimeType === 'image/png' || image.mimeType === 'image/webp' || image.mimeType === 'image/jpeg'
      ? image.mimeType
      : 'image/jpeg';

  const result = await withTimeout(
    client.generate(userPrompt, {
      systemPrompt: LLM_MATCH_SYSTEM_PROMPT,
      images: [{ mimeType: mime, data: base64 }],
      responseSchema: LLM_MATCH_SCHEMA,
      temperature: 0.1,
    }),
    timeoutMsFromEnv('IMAGE_MATCH_TIMEOUT_MS', 30_000),
    'Gemini image match',
  );

  const parsed = result.parsed as
    | { product_id: string; confidence: number; reasoning?: string }
    | undefined;
  if (!parsed) return null;
  const chosen = parsed.product_id?.trim();
  if (!chosen) return null;
  if (!limited.some((p) => p.id === chosen)) return null;
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (confidence < 0.4) return null;
  return { productId: chosen, reason: 'llm_vision', confidence };
}

/**
 * 画像を1枚受け取り、対応商品を返す。
 * excludeProductIds に含まれる商品は候補から外す（既に他画像に割り当て済み等）。
 */
export async function matchImageToProduct(
  image: ExtractedImage,
  products: ProductImageTarget[],
  options: MatchOptions = {},
): Promise<ProductImageMatch | null> {
  const enableLlm = options.enableLlmFallback ?? true;
  const maxLlmCandidates = options.maxLlmCandidates ?? 20;
  const sheetProducts = sameSheetCandidates(image, products);
  const excluded = options.excludeProductIds ?? new Set<string>();
  const available = sheetProducts.filter((p) => !excluded.has(p.id));
  if (available.length === 0) return null;

  const deterministic = deterministicMatch(image, available);
  if (deterministic) return deterministic;

  if (!enableLlm) return null;
  try {
    return await llmVisionMatch(image, available, maxLlmCandidates);
  } catch (err) {
    console.warn('[image-matching] LLM vision match failed:', err);
    return null;
  }
}
