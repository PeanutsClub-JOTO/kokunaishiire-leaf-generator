import { describe, it, expect } from 'vitest';
import { parseIrisu } from './irisu';

describe('parseIrisu', () => {
  it('"15×4" → {15, 4}', () => {
    const r = parseIrisu('15×4');
    expect(r.caseQty).toBe(15);
    expect(r.lotsPerKou).toBe(4);
    expect(r.parseError).toBe(false);
  });

  it('"12×1" → {12, 1}（甲なし）', () => {
    const r = parseIrisu('12×1');
    expect(r.caseQty).toBe(12);
    expect(r.lotsPerKou).toBe(1);
    expect(r.parseError).toBe(false);
  });

  it('"12x1" (半角x) → {12, 1}', () => {
    const r = parseIrisu('12x1');
    expect(r.caseQty).toBe(12);
    expect(r.lotsPerKou).toBe(1);
    expect(r.parseError).toBe(false);
  });

  it('"12X1" (大文字X) → {12, 1}', () => {
    const r = parseIrisu('12X1');
    expect(r.caseQty).toBe(12);
    expect(r.lotsPerKou).toBe(1);
    expect(r.parseError).toBe(false);
  });

  it('"12✕4" (特殊✕) → {12, 4}', () => {
    const r = parseIrisu('12✕4');
    expect(r.caseQty).toBe(12);
    expect(r.lotsPerKou).toBe(4);
    expect(r.parseError).toBe(false);
  });

  it('"20×2" → {20, 2}', () => {
    const r = parseIrisu('20×2');
    expect(r.caseQty).toBe(20);
    expect(r.lotsPerKou).toBe(2);
    expect(r.parseError).toBe(false);
  });

  it('"12" (数値のみ) → {12, 1}, parseError=false', () => {
    const r = parseIrisu('12');
    expect(r.caseQty).toBe(12);
    expect(r.lotsPerKou).toBe(1);
    expect(r.parseError).toBe(false);
  });

  it('空文字 → parseError=true', () => {
    const r = parseIrisu('');
    expect(r.parseError).toBe(true);
    expect(r.caseQty).toBe(0);
  });

  it('null → parseError=true', () => {
    const r = parseIrisu(null);
    expect(r.parseError).toBe(true);
  });

  it('文字列のみ → parseError=true', () => {
    const r = parseIrisu('不明');
    expect(r.parseError).toBe(true);
  });

  it('" 15 × 4 " (スペースあり) → {15, 4}', () => {
    const r = parseIrisu(' 15 × 4 ');
    expect(r.caseQty).toBe(15);
    expect(r.lotsPerKou).toBe(4);
    expect(r.parseError).toBe(false);
  });

  it('"５０×８袋" (全角数字・単位付き) → {50, 8}', () => {
    const r = parseIrisu('５０×８袋');
    expect(r.caseQty).toBe(50);
    expect(r.lotsPerKou).toBe(8);
    expect(r.parseError).toBe(false);
  });

  it('"100*6袋*2合" (アスタリスク区切り) → {100, 12}', () => {
    const r = parseIrisu('100*6袋*2合');
    expect(r.caseQty).toBe(100);
    expect(r.lotsPerKou).toBe(12);
    expect(r.parseError).toBe(false);
  });

  it('"60（5×12）" は先頭の総入数を優先する', () => {
    const r = parseIrisu('60（5×12）');
    expect(r.caseQty).toBe(60);
    expect(r.lotsPerKou).toBe(1);
    expect(r.parseError).toBe(false);
  });
});
