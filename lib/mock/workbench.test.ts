import { describe, expect, it } from 'vitest';
import { calcMockSingle, canMockAssort, type MockProduct } from './workbench';

function product(overrides: Partial<MockProduct> & { id: string }): MockProduct {
  const { id, ...rest } = overrides;
  return {
    id,
    no: null,
    sheetName: 'test',
    leafName: overrides.leafName ?? 'テスト商品',
    productCode: null,
    cost: overrides.cost ?? 400,
    irisu: overrides.irisu ?? 12,
    minLot: overrides.minLot ?? 12,
    ...calcMockSingle(overrides.cost ?? 400, overrides.minLot ?? 12),
    shelfLifeDays: 90,
    pieceSize: null,
    leadTime: '受注後約1週間',
    note: null,
    imageUrl: null,
    ...rest,
  };
}

describe('calcMockSingle', () => {
  it('minLotQtyを1ロット個数として扱い、入数を二重掛けしない', () => {
    const r = calcMockSingle(400, 12);
    expect(r.lotSize).toBe(12);
    expect(r.lotCost).toBe(4800);
    expect(r.leafQty).toBe(72);
    expect(r.wholesalePrice).toBe(39750);
    expect(Math.round(r.unitPrice * 10) / 10).toBe(552.1);
    expect(r.isEligible).toBe(true);
  });

  it('掲載単価が1000円を超える商品は対象外', () => {
    const r = calcMockSingle(1200, 12);
    expect(r.isEligible).toBe(false);
    expect(r.leafQty).toBe(24);
    expect(r.wholesalePrice).toBe(39750);
  });
});

describe('canMockAssort', () => {
  it('企画OKで単価が完全一致する別商品だけアソート対象にする', () => {
    const base = product({ id: 'base', cost: 400 });
    expect(canMockAssort(base, product({ id: 'same', cost: 400 }))).toBe(true);
    expect(canMockAssort(base, product({ id: 'diff', cost: 401 }))).toBe(false);
    expect(canMockAssort(base, product({ id: 'base', cost: 400 }))).toBe(false);
  });

  it('対象外の商品はアソート対象にしない', () => {
    const base = product({ id: 'base', cost: 1200 });
    const candidate = product({ id: 'candidate', cost: 1200 });
    expect(base.isEligible).toBe(false);
    expect(canMockAssort(base, candidate)).toBe(false);
  });
});
