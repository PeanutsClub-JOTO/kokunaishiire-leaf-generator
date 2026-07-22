export const DEFAULT_WHOLESALE_DIVISOR = 0.75;

export type WholesaleSettings = {
  // DBキーは既存互換で profit_coef のまま。新ルールでは掛率ではなく卸売価格の除数として扱う。
  profitCoef: number;
  salesAdd: number;
};

export function wholesaleDivisorFromSetting(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return DEFAULT_WHOLESALE_DIVISOR;
  }
  return value;
}

export function calculateWholesalePrice(costTotal: number, settings: WholesaleSettings): number {
  return costTotal / wholesaleDivisorFromSetting(settings.profitCoef) + settings.salesAdd;
}
