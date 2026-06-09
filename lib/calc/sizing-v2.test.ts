import { describe, it, expect } from 'vitest';
import { sizeSingleV2, sizeAssortV2, canAssort } from './sizing-v2';

describe('sizeSingleV2 — 単品（プライズ=商品1個, 単価=原価）', () => {
  it('塩レモン: 原価400 × 1ケース12 → 掲載単価400, 72個入, 卸28,800', () => {
    const r = sizeSingleV2(400, 12);
    expect(r.ok).toBe(true);
    expect(r.setCost).toBe(400);      // 判定用（単品なので原価と同じ）
    expect(r.unitPrice).toBe(400);    // 掲載単価
    expect(r.leafQty).toBe(72);       // 掲載入数（単品なので sets と同じ）
    expect(r.costTotal).toBe(28800);  // 掲載単価 × 掲載入数 = 卸価格
    expect(r.minLotPrice).toBe(4800);
  });

  it('涼ごこち: 原価150 × 1甲60 → 掲載単価150, 180個入, 卸27,000', () => {
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
  it('No6+No7: 原価460+460=920（判定）→ 掲載単価460, 24個入', () => {
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.setCost).toBe(920);       // 判定用の合計（≤1000でアソート成立）
    expect(r.unitPrice).toBe(460);     // 掲載単価 = 1商品の値段（920÷2）
    expect(r.leafQty).toBe(48);        // 掲載入数 = 総箱数（24セット×2種）
    expect(r.costTotal).toBe(22100);   // 460×48=22080 → 22100
    expect(r.itemCount).toBe(2);
  });

  it('No10+No11: 原価660+670=1330>1000 → アソート不可', () => {
    const r = sizeAssortV2([
      { cost: 660, minLotQty: 8, ratio: 1 },
      { cost: 670, minLotQty: 8, ratio: 1 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unit_over');
    expect(r.setCost).toBe(1330);
  });

  it('掲載単価 × 掲載入数 = 卸価格（100円切り上げ）が成り立つ', () => {
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(r.costTotal).toBe(Math.ceil((r.unitPrice * r.leafQty) / 100) * 100);
  });
});

describe('canAssort — アソート可否（原価合計 ≤ 1000）', () => {
  it('合計920はアソート可', () => expect(canAssort([460, 460])).toBe(true));
  it('合計1330はアソート不可', () => expect(canAssort([660, 670])).toBe(false));
});
