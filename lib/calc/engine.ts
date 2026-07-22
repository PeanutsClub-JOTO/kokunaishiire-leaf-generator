/**
 * 企画業務自動化システム — 計算エンジン (仕様書 v2.1 §6 + 付録A 準拠)
 *
 * すべて純粋関数。副作用・DB参照なし。
 * 定数は必ず Settings として外部から注入し、ハードコードしない。
 */
import { calculateWholesalePrice, DEFAULT_WHOLESALE_DIVISOR } from './wholesale';

export type Settings = {
  profitCoef: number;     // 卸価格の除数 (0.75)。DBキー名は既存互換で profit_coef のまま
  salesAdd: number;       // 営業上乗せ額 (3000)
  unitPriceCap: number;   // 単価通過ゲート上限 (1000)
  costCap: number;        // 仕入原価上限 (33000)
  halfBase: number;       // ハーフ可否基準 (16500)
  shelfMinDays: number;   // 賞味期限通過基準 (90)
};

export const DEFAULT_SETTINGS: Settings = {
  profitCoef: DEFAULT_WHOLESALE_DIVISOR,
  salesAdd: 3000,
  unitPriceCap: 1000,
  costCap: 33000,
  halfBase: 16500,
  shelfMinDays: 90,
};

export type SizingResult = {
  ok: boolean;
  reason?: string;          // ok=false のときの理由コード
  minLotPrice: number;      // 1ロット分の仕入原価
  maxLots: number;          // 最大ロット数（0のとき除外候補）
  leafQty: number;          // リーフ掲載入数
  costTotal: number;        // 仕入原価合計
  wholesale: number;        // 卸価格
  unitPrice: number;        // 1個あたり単価
  isHalfOk: boolean;        // ハーフ可否（1ロット価格 <= halfBase で判定。仕様書§3）
};

/**
 * 単品/アソート共通サイジング (§6.1)
 *
 * 「仕入原価が33,000円を超えない範囲で取れる最大ロット数」で企画数量を決める。
 * アソートは lotQty/lotPrice に合算値を渡す。
 */
export function sizeByMaxLot(
  lotPrice: number,
  lotQty: number,
  s: Settings,
): SizingResult {
  const base: SizingResult = {
    ok: false,
    minLotPrice: lotPrice,
    maxLots: 0,
    leafQty: 0,
    costTotal: 0,
    wholesale: 0,
    unitPrice: 0,
    isHalfOk: false,
  };

  if (lotPrice > s.costCap) {
    return { ...base, reason: 'cost_over' };
  }

  const maxLots = Math.floor(s.costCap / lotPrice);
  const leafQty = maxLots * lotQty;
  const costTotal = lotPrice * maxLots;
  const wholesale = calculateWholesalePrice(costTotal, s);
  const unitPrice = wholesale / leafQty;
  // ハーフ可否 (仕様書§3 / devlog): 1ロット価格(=lotPrice) が halfBase(16,500) 以下なら
  // 半口（ハーフ）でも成立する。単品=cost×min_lot_qty、アソート=合算1ロット価格。
  const isHalfOk = lotPrice <= s.halfBase;

  return {
    ok: true,
    minLotPrice: lotPrice,
    maxLots,
    leafQty,
    costTotal,
    wholesale,
    unitPrice,
    isHalfOk,
  };
}

/**
 * 通過条件判定 (§6.2) — 4条件すべて満たすと pass: true
 *
 * 1. 単価条件      : unitPrice ≤ unitPriceCap(1000)
 * 2. 最小ロット条件 : maxLots ≥ 1 (= minLotPrice ≤ costCap)
 * 3. 賞味期限条件   : shelfLifeDays が null でなく ≥ shelfMinDays(90)
 * 4. 販売期間条件   : today が [start, end] に含まれる（未設定は通過）
 */
export function passes(
  r: SizingResult,
  shelfLifeDays: number | null,   // null = 賞味期限データなし → 制限なしで通過
  salesStart: Date | null,
  salesEnd: Date | null,
  today: Date,
  s: Settings,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!r.ok) {
    if (r.reason === 'assort_unit_price_over') {
      reasons.push('assort_unit_price_over');
    } else {
      reasons.push('max_lots<1(cost_over)');
    }
  }
  if (r.ok && r.unitPrice > s.unitPriceCap) {
    reasons.push('unit_price>cap');
  }
  // null（不明）は制限なし扱い。0 は「0日 < 90日」で除外。
  if (shelfLifeDays !== null && shelfLifeDays < s.shelfMinDays) {
    reasons.push('shelf<min');
  }

  const inRange =
    salesStart === null || salesEnd === null
      ? true
      : salesStart <= today && today <= salesEnd;

  if (!inRange) {
    reasons.push('sales_out_of_range');
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * 単品サイジング (§6.1)
 */
export function planSingle(
  p: { cost: number; minLotQty: number },
  s: Settings,
): SizingResult {
  return sizeByMaxLot(p.cost * p.minLotQty, p.minLotQty, s);
}

export type AssortType = {
  cost: number;
  minLotQty: number;
  ratio: number;
};

/**
 * アソートサイジング (§6.3)
 *
 * 1アソートロット = 各種類が ratio_i × minLotQty_i 個ずつ入るセット
 *
 * 追加チェック: アソートは unitPrice × アイテム数 ≤ 1000 を通過条件とする。
 * (単品の単価上限1000円をアイテム数で按分した考え方)
 */
export function planAssort(
  types: AssortType[],
  s: Settings,
): SizingResult & { itemCount: number } {
  const lotQty = types.reduce((a, t) => a + t.ratio * t.minLotQty, 0);
  const lotPrice = types.reduce(
    (a, t) => a + t.cost * t.ratio * t.minLotQty,
    0,
  );
  const result = sizeByMaxLot(lotPrice, lotQty, s);

  // アソート専用: 単価 × アイテム数 > 1000円 → NG
  if (result.ok && result.unitPrice * types.length > 1000) {
    return {
      ...result,
      ok: false,
      reason: 'assort_unit_price_over',
      itemCount: types.length,
    };
  }

  return { ...result, itemCount: types.length };
}

/**
 * 注意フラグ判定 — 除外条件ではない補助情報 (§8)
 *
 * SizingResult が算出済みの状態で呼び出す。
 */
export function calcAlertFlags(
  r: SizingResult,
  shelfLifeDays: number | null,
  s: Settings = DEFAULT_SETTINGS,
): string[] {
  const flags: string[] = [];

  // 単価が上限の90%超〜上限以内: 上限近い警告
  if (r.ok && r.unitPrice > s.unitPriceCap * 0.9 && r.unitPrice <= s.unitPriceCap) {
    flags.push('unit_near_cap');
  }
  if (!r.ok && r.reason === 'cost_over') {
    flags.push('cost_over');
  }
  if (!r.ok && r.reason === 'assort_unit_price_over') {
    flags.push('assort_unit_price_over');
  }
  if (r.ok && r.wholesale > 45000) {
    flags.push('wholesale_over');
  }
  // 賞味期限が通過基準を満たすが 1.5倍未満（例: 90〜134日）
  if (
    shelfLifeDays !== null &&
    shelfLifeDays >= s.shelfMinDays &&
    shelfLifeDays < s.shelfMinDays * 1.5
  ) {
    flags.push('shelf_near');
  }

  return flags;
}
