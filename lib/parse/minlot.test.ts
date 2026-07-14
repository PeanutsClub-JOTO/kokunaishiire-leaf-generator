import { describe, it, expect } from 'vitest';
import { parseMinLot } from './minlot';

describe('parseMinLot', () => {
  // 1甲: N × caseQty × lotsPerKou
  it('"1甲" + {15,4} → 60', () => {
    const r = parseMinLot('1甲', 15, 4);
    expect(r.qty).toBe(60);
    expect(r.parseError).toBe(false);
  });

  it('"1甲" + {12,4} → 48', () => {
    const r = parseMinLot('1甲', 12, 4);
    expect(r.qty).toBe(48);
    expect(r.parseError).toBe(false);
  });

  it('"2甲" + {15,4} → 120', () => {
    const r = parseMinLot('2甲', 15, 4);
    expect(r.qty).toBe(120);
    expect(r.parseError).toBe(false);
  });

  // 1ケース: case_qty
  it('"1ケース" + {12,1} → 12', () => {
    const r = parseMinLot('1ケース', 12, 1);
    expect(r.qty).toBe(12);
    expect(r.parseError).toBe(false);
  });

  it('"2ケース" + {16,1} → 32', () => {
    const r = parseMinLot('2ケース', 16, 1);
    expect(r.qty).toBe(32);
    expect(r.parseError).toBe(false);
  });

  // 表記揺れ
  it('"1ケーズ" (誤記) + {12,1} → 12', () => {
    const r = parseMinLot('1ケーズ', 12, 1);
    expect(r.qty).toBe(12);
    expect(r.parseError).toBe(false);
  });

  it('"1ｹｰｽ" (半角カナ) + {12,1} → 12', () => {
    const r = parseMinLot('1ｹｰｽ', 12, 1);
    expect(r.qty).toBe(12);
    expect(r.parseError).toBe(false);
  });

  it('"1case" (英字) + {12,1} → 12', () => {
    const r = parseMinLot('1case', 12, 1);
    expect(r.qty).toBe(12);
    expect(r.parseError).toBe(false);
  });

  it('"混載10cs～" + {60,1} → 600', () => {
    const r = parseMinLot('混載10cs～', 60, 1);
    expect(r.qty).toBe(600);
    expect(r.parseError).toBe(false);
  });

  // ピース
  it('"48ピース" → 48', () => {
    const r = parseMinLot('48ピース', 12, 1);
    expect(r.qty).toBe(48);
    expect(r.parseError).toBe(false);
  });

  it('"24個" → 24', () => {
    const r = parseMinLot('24個', 12, 1);
    expect(r.qty).toBe(24);
    expect(r.parseError).toBe(false);
  });

  // こう（ひらがな）
  it('"1こう" + {15,4} → 60', () => {
    const r = parseMinLot('1こう', 15, 4);
    expect(r.qty).toBe(60);
    expect(r.parseError).toBe(false);
  });

  // 全角数字
  it('"１甲" (全角数字) + {15,4} → 60', () => {
    const r = parseMinLot('１甲', 15, 4);
    expect(r.qty).toBe(60);
    expect(r.parseError).toBe(false);
  });

  // エラーケース
  it('空文字 → parseError=true', () => {
    const r = parseMinLot('', 12, 1);
    expect(r.parseError).toBe(true);
    expect(r.qty).toBe(0);
  });

  it('null → parseError=true', () => {
    const r = parseMinLot(null, 12, 1);
    expect(r.parseError).toBe(true);
  });
});
