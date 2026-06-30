import { describe, it, expect } from 'vitest';
import { sizeSingleV2, sizeAssortV2, canAssort } from './sizing-v2';

const round1 = (n: number) => Math.round(n * 10) / 10;

describe('sizeSingleV2 — 単品（1商品パッケージ=1個, 卸価格÷入数で判定）', () => {
  it('塩レモン: 原価400 × 1ケース12 → 72個入, 卸39,750, 掲載単価約552.1', () => {
    const r = sizeSingleV2(400, 12);
    expect(r.ok).toBe(true);
    expect(r.setCost).toBe(400);      // 判定用（単品なので原価と同じ）
    expect(r.leafQty).toBe(72);       // 掲載入数（単品なので sets と同じ）
    expect(r.costTotal).toBe(28800);
    expect(r.wholesale).toBe(39750);
    expect(round1(r.unitPrice)).toBe(552.1);
    expect(r.minLotPrice).toBe(4800);
  });

  it('涼ごこち: 原価150 × 1甲60 → 180個入, 卸37,500', () => {
    const r = sizeSingleV2(150, 60);
    expect(r.leafQty).toBe(180);
    expect(r.costTotal).toBe(27000);
    expect(r.wholesale).toBe(37500);
    expect(round1(r.unitPrice)).toBe(208.3);
  });

  it('仕入原価合計と卸価格を分けて持つ（原価465×2ケース32 → 原価29,760, 卸40,950）', () => {
    const r = sizeSingleV2(465, 32);
    expect(r.costTotal).toBe(29760);
    expect(r.wholesale).toBe(40950);
    expect(round1(r.unitPrice)).toBe(639.8);
  });

  it('卸価格÷入数が1000円超なら企画対象外', () => {
    const r = sizeSingleV2(1200, 12);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unit_over');
    expect(r.leafQty).toBe(24);
    expect(r.wholesale).toBe(39750);
    expect(round1(r.unitPrice)).toBe(1656.3);
  });

  it('最小ロット1本で33,000円超なら企画対象外', () => {
    const r = sizeSingleV2(500, 100); // 500×100=50000 > 33000
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cost_over');
  });
});

describe('sizeAssortV2 — アソート', () => {
  it('同条件アソートは各商品の単品卸価格をアイテム数で按分し、単品と同じ卸価格になる', () => {
    const single = sizeSingleV2(460, 12);
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.minLotPrice).toBe(single.minLotPrice);
    expect(r.maxLots).toBe(single.maxLots);
    expect(r.leafQty).toBe(single.leafQty);
    expect(r.costTotal).toBe(single.costTotal);
    expect(r.wholesale).toBe(single.wholesale);
    expect(round1(r.unitPrice)).toBe(round1(single.unitPrice));
    expect(r.itemCount).toBe(2);
  });

  it('条件が揃わないアソートは各商品の入数ロットを合算して判定する', () => {
    const r = sizeAssortV2([
      { cost: 660, minLotQty: 8, ratio: 1 },
      { cost: 670, minLotQty: 8, ratio: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.minLotPrice).toBe(10640); // 660×8 + 670×8
    expect(r.maxLots).toBe(3);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(31920);
    expect(r.wholesale).toBe(43650);
    expect(round1(r.unitPrice)).toBe(909.4);
  });

  it('同条件アソートは比率を変えても単品と同じ卸価格になる', () => {
    const single = sizeSingleV2(460, 12);
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 2 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.setCost).toBe(1380);
    expect(r.minLotPrice).toBe(single.minLotPrice);
    expect(r.maxLots).toBe(single.maxLots);
    expect(r.leafQty).toBe(single.leafQty);
    expect(r.costTotal).toBe(single.costTotal);
    expect(r.wholesale).toBe(single.wholesale);
    expect(round1(r.unitPrice)).toBe(round1(single.unitPrice));
  });

  it('掲載単価 × 掲載入数 = 卸価格 が成り立つ', () => {
    const r = sizeAssortV2([
      { cost: 460, minLotQty: 12, ratio: 1 },
      { cost: 460, minLotQty: 12, ratio: 1 },
    ]);
    expect(round1(r.unitPrice * r.leafQty)).toBe(round1(r.wholesale));
  });
});

describe('canAssort — アソート可否の簡易判定', () => {
  it('合計920はアソート可', () => expect(canAssort([460, 460])).toBe(true));
  it('合計1330でも各商品が1000円以内ならアソート可', () => expect(canAssort([660, 670])).toBe(true));
  it('1.25倍時点で1000円に届く商品はアソート不可', () => expect(canAssort([460, 800])).toBe(false));
});
