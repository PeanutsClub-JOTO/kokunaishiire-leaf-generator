/**
 * アソートグルーピング (仕様書 v2.1 §7)
 *
 * 同一シート内で次の4項目が一致する商品を1つの候補グループにまとめる:
 * 1. メーカー（完全一致）
 * 2. 規格（spec_pieces同士 or spec_grams同士の一致。型違いは不一致）
 * 3. 入数（case_qty × lots_per_kou の一致）
 * 4. 上代（差が retailTolerance 以内。既定0=完全一致）
 *
 * 候補が1商品のみ → is_single=true
 */

export type ProductForGrouping = {
  id: string;
  maker_name: string | null;
  spec_pieces: number | null;
  spec_grams: number | null;
  case_qty: number | null;
  lots_per_kou: number | null;
  retail_price: number | null;
  cost: number;
  min_lot_qty: number;
};

export type AssortGroup = {
  group_key: string;
  is_single: boolean;
  product_ids: string[];
};

// 規格の型が一致し値も一致するか
function specMatches(
  a: ProductForGrouping,
  b: ProductForGrouping,
): boolean {
  if (a.spec_pieces !== null && b.spec_pieces !== null) {
    return a.spec_pieces === b.spec_pieces;
  }
  if (a.spec_grams !== null && b.spec_grams !== null) {
    return a.spec_grams === b.spec_grams;
  }
  return false;
}

// 入数が一致するか
function irisuMatches(
  a: ProductForGrouping,
  b: ProductForGrouping,
): boolean {
  const aTotal = (a.case_qty ?? 0) * (a.lots_per_kou ?? 1);
  const bTotal = (b.case_qty ?? 0) * (b.lots_per_kou ?? 1);
  return aTotal > 0 && aTotal === bTotal;
}

// 上代が許容差以内か
function retailMatches(
  a: ProductForGrouping,
  b: ProductForGrouping,
  tolerance: number,
): boolean {
  if (a.retail_price === null || b.retail_price === null) return false;
  return Math.abs(a.retail_price - b.retail_price) <= tolerance;
}

// グループキーを生成（メーカー|規格正規化|入数|上代バケット）
function buildGroupKey(p: ProductForGrouping, tolerance: number): string {
  const maker = p.maker_name ?? '';
  const spec =
    p.spec_pieces !== null
      ? `pieces:${p.spec_pieces}`
      : p.spec_grams !== null
        ? `grams:${p.spec_grams}`
        : 'unknown';
  const irisu = `${(p.case_qty ?? 0) * (p.lots_per_kou ?? 1)}`;
  // 上代バケット: tolerance=0 なら実値、>0 なら floor(retail/tolerance)*tolerance
  // 例: tolerance=100, retail=1560 → floor(1560/100)*100=1500 (同バケット)
  //     tolerance=100, retail=1500 → floor(1500/100)*100=1500 (同バケット) ✓
  const retail =
    p.retail_price === null
      ? 'null'
      : tolerance === 0
        ? String(p.retail_price)
        : String(Math.floor(p.retail_price / tolerance) * tolerance);
  return `${maker}|${spec}|${irisu}|${retail}`;
}

/**
 * 商品リストをアソート候補グループに分類する
 *
 * @param products 同一シート内の商品リスト
 * @param retailTolerance 上代の許容差（app_settings.retail_tolerance）
 */
export function groupProducts(
  products: ProductForGrouping[],
  retailTolerance: number,
): AssortGroup[] {
  const groups = new Map<string, string[]>();

  for (const p of products) {
    // 4項目すべて揃っていない商品は単品扱い
    if (
      !p.maker_name ||
      (p.spec_pieces === null && p.spec_grams === null) ||
      !p.case_qty ||
      p.retail_price === null
    ) {
      const singleKey = `single:${p.id}`;
      groups.set(singleKey, [p.id]);
      continue;
    }

    const key = buildGroupKey(p, retailTolerance);
    const existing = groups.get(key);
    if (existing) {
      existing.push(p.id);
    } else {
      groups.set(key, [p.id]);
    }
  }

  return Array.from(groups.entries()).map(([key, ids]) => ({
    group_key: key,
    is_single: ids.length === 1,
    product_ids: ids,
  }));
}

/**
 * アソートグループ内の上代差に対して retail_mismatch フラグが必要かチェック
 */
export function hasRetailMismatch(
  products: ProductForGrouping[],
  tolerance: number,
): boolean {
  if (products.length < 2) return false;
  const prices = products
    .map((p) => p.retail_price)
    .filter((p): p is number => p !== null);
  if (prices.length < 2) return false;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return max - min > tolerance;
}
