/**
 * 新サイジングロジック v2（ヒアリング 2026-06-09 最終確定）
 *
 * 【モデル】
 *  - 1商品 = 1規格パッケージ（例: 9個入り = 1個。中身個数は分解しない）。
 *  - 1商品パッケージ = 1個。規格の「9個入り」など中身個数は分解しない。
 *  - 入数/最小ロット数量が「1ロット」の箱数になる。
 *      例: 入数 12×4 = 48個で1ロット。
 *      例: 最小ロット 5ケースなら caseQty×5 個で1ロット。
 *  - 数量: 1ロット原価が costCap(33,000) を超えたら企画対象外。
 *      超えない場合は、仕入原価合計が33,000円以内で最大のロット数を掲載する。
 *  - 掲載卸売価格 = 仕入原価合計 ÷ profitCoef + salesAdd。
 *  - 掲載単価 = 掲載卸売価格 ÷ 掲載入数。これが unitPriceCap 以下なら企画化。
 */
import { calculateWholesalePrice, DEFAULT_WHOLESALE_DIVISOR, wholesaleDivisorFromSetting } from './wholesale';

export type SizingV2Settings = {
  profitCoef: number;   // 卸価格の除数（0.75）。DBキー名は既存互換で profit_coef のまま
  salesAdd: number;     // 営業上乗せ額（3000）
  unitPriceCap: number; // 掲載単価の上限（1000）
  costCap: number;      // 仕入原価合計の上限（33000）
  halfBase: number;     // ハーフ基準（16500）
};

export const DEFAULT_V2_SETTINGS: SizingV2Settings = {
  profitCoef: DEFAULT_WHOLESALE_DIVISOR,
  salesAdd: 3000,
  unitPriceCap: 1000,
  costCap: 33000,
  halfBase: 16500,
};

export type SizingV2Result = {
  ok: boolean;
  reason?: string;         // unit_over / cost_over / no_cost

  // ── 判定用（内部ロジック） ────────────────────────
  setCost: number;         // 比率1組あたりの原価合計（参考）
  sets: number;            // 掲載ロット数

  // ── 掲載用（リーフに表示する値） ─────────────────
  unitPrice: number;       // 掲載単価 = wholesale ÷ leafQty
  leafQty: number;         // 掲載入数 = 総箱数
  costTotal: number;       // 仕入原価合計 = 原価 × 掲載入数
  wholesale: number;       // 掲載卸売価格 = costTotal ÷ profitCoef + salesAdd

  minLotPrice: number;     // 最小ロット原価（参考）
  maxLots: number;         // ロット数（参考）
  isHalfOk: boolean;       // ハーフ可否
};

export type AssortTypeV2 = {
  cost: number;
  minLotQty: number;
  ratio: number;
};

const fail = (
  reason: string,
  setCost = 0,
  itemCount = 1,
  unitPrice = 0,
  wholesale = 0,
): SizingV2Result & { itemCount: number } => ({
  ok: false, reason, setCost, sets: 0,
  unitPrice,
  minLotPrice: 0, maxLots: 0,
  leafQty: 0, costTotal: 0, wholesale, isHalfOk: false, itemCount,
});

/**
 * ロット方式の共通サイジング。単品・アソート兼用。
 */
function sizeSets(
  types: AssortTypeV2[],
  s: SizingV2Settings,
): SizingV2Result & { itemCount: number } {
  const activeTypes = types.filter((t) => t.ratio > 0);
  const itemCount = activeTypes.length;
  const setCost = activeTypes.reduce((a, t) => a + t.cost * t.ratio, 0);
  if (itemCount === 0 || setCost <= 0) return fail('no_cost', 0, itemCount);

  const lotQty = activeTypes.reduce((a, t) => a + Math.max(t.minLotQty, 1) * t.ratio, 0);
  const lotPrice = activeTypes.reduce(
    (a, t) => a + t.cost * Math.max(t.minLotQty, 1) * t.ratio,
    0,
  );

  if (lotQty <= 0 || lotPrice <= 0) return fail('no_cost', setCost, itemCount);

  // 1ロットが33,000円を超えたら完全に企画対象外。
  if (lotPrice > s.costCap) return fail('cost_over', setCost, itemCount);

  const maxLots = Math.floor(s.costCap / lotPrice);
  if (maxLots < 1) return fail('cost_over', setCost, itemCount);

  const leafQty = lotQty * maxLots;
  const costTotal = lotPrice * maxLots;
  const wholesale = calculateWholesalePrice(costTotal, s);
  const unitPrice = wholesale / leafQty;
  const isHalfOk = lotPrice <= s.halfBase;
  const ok = unitPrice <= s.unitPriceCap;

  return {
    ok,
    reason: ok ? undefined : 'unit_over',
    setCost,
    sets: maxLots,
    unitPrice,
    leafQty,
    costTotal,
    wholesale,
    minLotPrice: lotPrice,
    maxLots,
    isHalfOk,
    itemCount,
  };
}

/** 単品サイジング（1商品パッケージ = 1個） */
export function sizeSingleV2(
  cost: number,
  minLotQty: number,
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): SizingV2Result {
  return sizeSets([{ cost, minLotQty, ratio: 1 }], s);
}

function hasSameAssortBasis(types: AssortTypeV2[]): boolean {
  if (types.length < 2) return false;
  const first = types[0];
  return types.every(
    (t) => t.cost === first.cost && Math.max(t.minLotQty, 1) === Math.max(first.minLotQty, 1),
  );
}

/**
 * 同一条件アソートは、各商品の単品卸価格をアイテム数で按分して合算する。
 * 候補グループ側で上代・規格・入数も揃えているため、合計は単品掲載時と同じになる。
 */
function sizeMatchedAssort(
  activeTypes: AssortTypeV2[],
  s: SizingV2Settings,
): SizingV2Result & { itemCount: number } {
  const itemCount = activeTypes.length;
  const first = activeTypes[0];
  const single = sizeSets([{ cost: first.cost, minLotQty: first.minLotQty, ratio: 1 }], s);

  return {
    ...single,
    // 単品価格をアイテム数で按分して足すため、合計は単品掲載時と同額。
    wholesale: single.wholesale,
    costTotal: single.costTotal,
    leafQty: single.leafQty,
    unitPrice: single.unitPrice,
    setCost: activeTypes.reduce((a, t) => a + t.cost * t.ratio, 0),
    itemCount,
  };
}

/** アソートサイジング */
export function sizeAssortV2(
  types: AssortTypeV2[],
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): SizingV2Result & { itemCount: number } {
  const activeTypes = types.filter((t) => t.ratio > 0);
  if (hasSameAssortBasis(activeTypes)) {
    return sizeMatchedAssort(activeTypes, s);
  }
  return sizeSets(types, s);
}

/**
 * アソート可否の事前判定（数量計算前）。
 * メーカー・規格・入数・上代でグルーピング済みの候補に対し、
 * 詳細な可否は数量計算後に判定する。ここでは明らかに成立しない原価を除く。
 */
export function canAssort(
  costs: number[],
  s: SizingV2Settings = DEFAULT_V2_SETTINGS,
): boolean {
  const divisor = wholesaleDivisorFromSetting(s.profitCoef);
  return costs.length > 0 && costs.every((c) => c > 0 && c / divisor < s.unitPriceCap);
}
