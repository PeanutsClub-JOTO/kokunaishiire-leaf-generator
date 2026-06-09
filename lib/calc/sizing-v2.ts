/**
 * 新サイジングロジック v2（ヒアリング 2026-06-09 最終確定）
 *
 * 【モデル】
 *  - 1商品 = 1規格パッケージ（例: 9個入り = 1個。中身個数は分解しない）。
 *  - プライズ（景品1個） = 1セット。
 *      単品  : 1セット = その商品1個。       単価 = 原価。
 *      アソート: 1セット = 各タイプ ratio_i 個ずつ。単価 = Σ(ratio_i × 原価_i)（＝合計）。
 *  - 単価（プライズ1個の原価）が unitPriceCap(1000) を超えたら企画対象外。
 *      アソートは「両商品を1つにする」ため原価を足し、1000円を超えるとアソート不可。
 *  - 数量: 仕入原価合計が costCap(33,000) を超えない範囲で最大のセット数。
 *      発注はケース（最小ロット）単位なので、セット数は最小ロットを満たす刻みに丸める。
 *  - 仕入原価合計は 100円単位で切り上げ。卸価格 = 仕入原価合計。
 *  - 単価 × 入数(セット数) = 卸価格 となる。
 */

export type SizingV2Settings = {
  unitPriceCap: number; // 単価(プライズ原価)の上限（1000）
  costCap: number;      // 仕入原価合計の上限（33000）
  halfBase: number;     // ハーフ基準（16500）
};

export const DEFAULT_V2_SETTINGS: SizingV2Settings = {
  unitPriceCap: 1000,
  costCap: 33000,
  halfBase: 16500,
};

export type SizingV2Result = {
  ok: boolean;
  reason?: string;         // unit_over / cost_over / no_cost

  // ── 判定用（内部ロジック） ────────────────────────
  setCost: number;         // 1セットの原価合計（アソート判定：≤1000 で成立）
  sets: number;            // セット（プライズ）数

  // ── 掲載用（リーフに表示する値） ─────────────────
  unitPrice: number;       // 掲載単価 = 1商品あたりの原価（setCost ÷ 種類数）
  leafQty: number;         // 掲載入数 = 総箱数（sets × 種類数）
  costTotal: number;       // 仕入原価合計 = 卸価格（unitPrice × leafQty の100円切り上げ）

  minLotPrice: number;     // 最小ロット原価（参考）
  maxLots: number;         // ロット数（参考）
  isHalfOk: boolean;       // ハーフ可否
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Math.max(a, b, 1);
  return (a / gcd(a, b)) * b;
}
function ceil100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

export type AssortTypeV2 = {
  cost: number;
  minLotQty: number;
  ratio: number;
};

const fail = (reason: string, setCost = 0, itemCount = 1): SizingV2Result & { itemCount: number } => ({
  ok: false, reason, setCost, sets: 0,
  unitPrice: itemCount > 0 ? setCost / itemCount : 0,
  minLotPrice: 0, maxLots: 0,
  leafQty: 0, costTotal: 0, isHalfOk: false, itemCount,
});

/**
 * セット（プライズ）方式の共通サイジング。単品・アソート兼用。
 */
function sizeSets(
  types: AssortTypeV2[],
  s: SizingV2Settings,
): SizingV2Result & { itemCount: number } {
  const itemCount = types.length;
  // 単価 = 1プライズ(セット)の原価合計
  const setCost = types.reduce((a, t) => a + t.cost * t.ratio, 0);
  const setBoxes = types.reduce((a, t) => a + t.ratio, 0);
  if (setCost <= 0 || setBoxes <= 0) return fail('no_cost', 0, itemCount);

  // 単価が上限超 → 企画対象外（アソートなら「合計>1000でアソート不可」）
  if (setCost > s.unitPriceCap) return fail('unit_over', setCost, itemCount);

  // 最小発注（ケース）を満たすセット数の刻み。
  // タイプ毎に「最小ロットを ratio で割った必要セット数」を求め、その最小公倍数。
  let step = 1;
  for (const t of types) {
    const per = t.ratio > 0 ? Math.ceil(t.minLotQty / t.ratio) : t.minLotQty;
    step = lcm(step, Math.max(per, 1));
  }

  const lotPrice = setCost * step; // 1ロット（最小発注）の原価
  if (lotPrice > s.costCap) return fail('cost_over', setCost, itemCount);

  const maxSets = Math.floor(s.costCap / setCost);
  const sets = Math.floor(maxSets / step) * step; // ケース単位に丸めたセット数
  if (sets < step) return fail('cost_over', setCost, itemCount);

  // 掲載用に変換
  // unitPrice = 1商品あたりの原価（setCost ÷ 種類数）
  // leafQty   = 総箱数（sets × 種類数）
  // → unitPrice × leafQty = setCost × sets ✓（整合）
  const unitPrice = setCost / itemCount;
  const leafQty = sets * itemCount;
  const costTotal = ceil100(unitPrice * leafQty);
  const isHalfOk = lotPrice <= s.halfBase;

  return {
    ok: true,
    setCost,
    sets,
    unitPrice,
    leafQty,
    costTotal,
    minLotPrice: lotPrice,
    maxLots: sets / step,
    isHalfOk,
    itemCount,
  };
}

/** 単品サイジング（1プライズ = 商品1個） */
export function sizeSingleV2(
  cost: number,
  minLotQty: number,
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): SizingV2Result {
  return sizeSets([{ cost, minLotQty, ratio: 1 }], s);
}

/** アソートサイジング（1プライズ = 各タイプ ratio 個ずつ。単価 = 原価合計） */
export function sizeAssortV2(
  types: AssortTypeV2[],
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): SizingV2Result & { itemCount: number } {
  return sizeSets(types, s);
}

/**
 * アソート可否の事前判定（数量計算前）。
 * メーカー・規格・入数・上代でグルーピング済みの候補に対し、
 * 「原価合計（比率1:1想定）が unitPriceCap 以内か」で成立可否を返す。
 */
export function canAssort(
  costs: number[],
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): boolean {
  const sum = costs.reduce((a, c) => a + c, 0);
  return sum > 0 && sum <= s.unitPriceCap;
}
