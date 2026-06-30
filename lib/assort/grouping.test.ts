import { describe, it, expect } from 'vitest';
import { groupProducts, hasRetailMismatch, type ProductForGrouping } from './grouping';

// テスト用の商品データファクトリ
function makeProduct(overrides: Partial<ProductForGrouping> & { id: string }): ProductForGrouping {
  return {
    id: overrides.id,
    maker_name: overrides.maker_name ?? '金澤兼六製菓',
    spec_pieces: overrides.spec_pieces ?? null,
    spec_grams: overrides.spec_grams ?? null,
    case_qty: overrides.case_qty ?? 12,
    lots_per_kou: overrides.lots_per_kou ?? 1,
    retail_price: overrides.retail_price ?? 1000,
    cost: overrides.cost ?? 400,
    min_lot_qty: overrides.min_lot_qty ?? 12,
  };
}

describe('groupProducts', () => {
  it('6条件完全一致の2商品は同グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6 }),
      makeProduct({ id: 'p2', spec_pieces: 6 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(1);
    expect(groups[0].product_ids).toContain('p1');
    expect(groups[0].product_ids).toContain('p2');
    expect(groups[0].is_single).toBe(false);
  });

  it('6条件完全一致の4商品は同グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6 }),
      makeProduct({ id: 'p2', spec_pieces: 6 }),
      makeProduct({ id: 'p3', spec_pieces: 6 }),
      makeProduct({ id: 'p4', spec_pieces: 6 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(1);
    expect(groups[0].product_ids).toHaveLength(4);
  });

  it('単独商品はis_single=true', () => {
    const products = [makeProduct({ id: 'p1', spec_pieces: 6 })];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(1);
    expect(groups[0].is_single).toBe(true);
  });

  it('上代60円差 + tolerance=0 → 別グループ（金澤⑨⑩ケース）', () => {
    const products = [
      makeProduct({ id: 'p9', spec_pieces: 12, retail_price: 1560 }),   // ⑨
      makeProduct({ id: 'p10', spec_pieces: 12, retail_price: 1500 }),  // ⑩
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
    groups.forEach((g) => expect(g.is_single).toBe(true));
  });

  it('上代60円差 + tolerance=100 → 同グループ', () => {
    const products = [
      makeProduct({ id: 'p9', spec_pieces: 12, retail_price: 1560 }),
      makeProduct({ id: 'p10', spec_pieces: 12, retail_price: 1500 }),
    ];
    const groups = groupProducts(products, 100);
    expect(groups).toHaveLength(1);
    expect(groups[0].is_single).toBe(false);
  });

  it('規格の型違い（pieces vs grams）は別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6, spec_grams: null }),
      makeProduct({ id: 'p2', spec_pieces: null, spec_grams: 125 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('規格の値違いは別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6 }),
      makeProduct({ id: 'p2', spec_pieces: 9 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('入数違いは別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6, case_qty: 12, lots_per_kou: 1 }),
      makeProduct({ id: 'p2', spec_pieces: 6, case_qty: 12, lots_per_kou: 4 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('単価違いは別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6, cost: 400 }),
      makeProduct({ id: 'p2', spec_pieces: 6, cost: 420 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('最小ロット数違いは別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', spec_pieces: 6, min_lot_qty: 12 }),
      makeProduct({ id: 'p2', spec_pieces: 6, min_lot_qty: 24 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('メーカー違いは別グループ', () => {
    const products = [
      makeProduct({ id: 'p1', maker_name: '金澤兼六製菓', spec_pieces: 6 }),
      makeProduct({ id: 'p2', maker_name: '北辰フーズ', spec_pieces: 6 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(2);
  });

  it('maker_nameがnullの商品は単品扱い', () => {
    const products = [
      makeProduct({ id: 'p1', maker_name: null }),
      makeProduct({ id: 'p2', maker_name: null }),
    ];
    const groups = groupProducts(products, 0);
    // maker_nameがnullなので個別にsingle
    expect(groups).toHaveLength(2);
    groups.forEach((g) => expect(g.is_single).toBe(true));
  });

  it('retail_priceがnullの商品は単品扱い', () => {
    const products = [
      makeProduct({ id: 'p1', retail_price: null, spec_pieces: 6 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups[0].is_single).toBe(true);
  });

  it('混在ケース: 2組のアソート候補 + 1単品', () => {
    const products = [
      // グループA（spec=6個, 上代1000）
      makeProduct({ id: 'a1', spec_pieces: 6, retail_price: 1000 }),
      makeProduct({ id: 'a2', spec_pieces: 6, retail_price: 1000 }),
      // グループB（spec=9個, 上代1500）
      makeProduct({ id: 'b1', spec_pieces: 9, retail_price: 1500 }),
      makeProduct({ id: 'b2', spec_pieces: 9, retail_price: 1500 }),
      // 単品（spec=12g, 上代1000）
      makeProduct({ id: 'c1', spec_pieces: null, spec_grams: 125, retail_price: 1000 }),
    ];
    const groups = groupProducts(products, 0);
    expect(groups).toHaveLength(3);
    const singles = groups.filter((g) => g.is_single);
    expect(singles).toHaveLength(1);
  });
});

describe('hasRetailMismatch', () => {
  it('上代差が tolerance 以内は false', () => {
    const products = [
      makeProduct({ id: 'p1', retail_price: 1000 }),
      makeProduct({ id: 'p2', retail_price: 1000 }),
    ];
    expect(hasRetailMismatch(products, 0)).toBe(false);
  });

  it('上代差が tolerance 超は true', () => {
    const products = [
      makeProduct({ id: 'p1', retail_price: 1560 }),
      makeProduct({ id: 'p2', retail_price: 1500 }),
    ];
    expect(hasRetailMismatch(products, 0)).toBe(true);
    expect(hasRetailMismatch(products, 50)).toBe(true);
    expect(hasRetailMismatch(products, 60)).toBe(false);
    expect(hasRetailMismatch(products, 100)).toBe(false);
  });

  it('商品1件の場合は常に false', () => {
    const products = [makeProduct({ id: 'p1', retail_price: 1000 })];
    expect(hasRetailMismatch(products, 0)).toBe(false);
  });
});
