import { describe, it, expect } from 'vitest';
import { sizeSingleV2, sizeAssortV2, canAssort } from './sizing-v2';

describe('sizeSingleV2 — 単品（プライズ=商品1個, 単価=原価）', () => {
  it('塩レモン: 原価400 × 1ケース12 → 単価400, 72個入, 原価合計28,800', () => {
    const r = sizeSingleV2(400, 12);
    expect(r.ok).toBe(true);
    expect(r.unitPrice).toBe(400);
    expect(r.leafQty).toBe(72);       // プライズ数 = 箱数（単品なので一致）
    expect(r.costTotal).toBe(28800);  // 単価 × 入数 = 卸価格
    expect(r.minLotPrice).toBe(4800);
  });

  it('涼ごこち: 原価150 × 1甲60 → 単価150, 180個入, 原価合計27,000', () => {
    const r = sizeSingleV2(150, 60);
    expect(r.unitPrice).toBe(150);
    expect(r.leafQty).toBe(180);
    expect(r.costTotal).toBe(27000);
  });

  it('仕入原価合計は100円単位で切り上げ（原価465×2ケース32 → 29,800）', () => {
    const r = sizeSingleV2(465, 32);
    expect(r.costTotal % 100).toBe(0);
    expect(r.costTotal).toBe(29800);
  });

  it('単価(原価)が1000円超なら企画対象外', () => {
    const r = sizeSingleV2(1200, 12);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unit_over');
  });

  it('最小ロット1本で33,000円超なら企画対象外', () => {
    const r = sizeSingleV2(500, 100); // 500×100=50000 > 33000
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cost_over');
  });
});

describe('sizeAssortV2 — アソート（単価=原価の合計）', () => {
  it('No6+No7: 原価460+460=920 → アソート成立, 単価920', () => {
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.unitPrice).toBe(920);     // 合計（平均ではない）
    expect(r.leafQty).toBe(24);        // プライズ（セット）数
    expect(r.costTotal).toBe(22100);   // 920×24=22080 → 100円切り上げ
    expect(r.itemCount).toBe(2);
  });

  it('No10+No11: 原価660+670=1330>1000 → アソート不可', () => {
    const r = sizeAssortV2([
      { cost: 660, minLotQty: 8, ratio: 1 },
      { cost: 670, minLotQty: 8, ratio: 1 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unit_over');
    expect(r.unitPrice).toBe(1330);    // 合計が単価
  });

  it('単価 × 入数 = 卸価格 が成り立つ（成立アソート）', () => {
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    // 920 × 24 = 22080 → 100円切り上げ 22100
    expect(r.costTotal).toBe(Math.ceil((r.unitPrice * r.leafQty) / 100) * 100);
  });
});

describe('canAssort — アソート可否（原価合計 ≤ 1000）', () => {
  it('合計920はアソート可', () => expect(canAssort([460, 460])).toBe(true));
  it('合計1330はアソート不可', () => expect(canAssort([660, 670])).toBe(false));
});
