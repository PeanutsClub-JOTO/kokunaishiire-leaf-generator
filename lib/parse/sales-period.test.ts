import { describe, it, expect } from 'vitest';
import { parseSalesPeriod, parseShelfLife } from './sales-period';

describe('parseSalesPeriod', () => {
  it('"2026.04.17〜2026.07.31" → {start:2026-04-17, end:2026-07-31}', () => {
    const r = parseSalesPeriod('2026.04.17〜2026.07.31');
    expect(r.parseError).toBe(false);
    expect(r.start).toEqual(new Date(2026, 3, 17));  // month is 0-indexed
    expect(r.end).toEqual(new Date(2026, 6, 31));
  });

  it('"2026.04.17~2026.07.31" (半角チルダ) → 同上', () => {
    const r = parseSalesPeriod('2026.04.17~2026.07.31');
    expect(r.parseError).toBe(false);
    expect(r.start).toEqual(new Date(2026, 3, 17));
    expect(r.end).toEqual(new Date(2026, 6, 31));
  });

  it('"2026.04.17-2026.07.31" (ハイフン) → 同上', () => {
    const r = parseSalesPeriod('2026.04.17-2026.07.31');
    expect(r.parseError).toBe(false);
    expect(r.start).toEqual(new Date(2026, 3, 17));
    expect(r.end).toEqual(new Date(2026, 6, 31));
  });

  it('空欄/null → {start:null, end:null, parseError:false}（制限なし）', () => {
    expect(parseSalesPeriod('')).toEqual({ start: null, end: null, parseError: false });
    expect(parseSalesPeriod(null)).toEqual({ start: null, end: null, parseError: false });
    expect(parseSalesPeriod(undefined)).toEqual({ start: null, end: null, parseError: false });
  });

  it('"2025.04.17〜2025.07.31" (2025年 = 過去) → パース成功・販売期間外は呼び出し側で判定', () => {
    const r = parseSalesPeriod('2025.04.17〜2025.07.31');
    expect(r.parseError).toBe(false);
    expect(r.start?.getFullYear()).toBe(2025);
    expect(r.end?.getFullYear()).toBe(2025);
  });

  it('形式不正 → parseError=true, nullを返す', () => {
    const r = parseSalesPeriod('不明');
    expect(r.parseError).toBe(true);
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });

  it('"-" (ダッシュのみ) → {null, null, parseError:false}', () => {
    const r = parseSalesPeriod('-');
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });
});

describe('parseShelfLife', () => {
  it('"240日（240日）" → 240', () => {
    const r = parseShelfLife('240日（240日）');
    expect(r.days).toBe(240);
    expect(r.parseError).toBe(false);
  });

  it('"90日" → 90', () => {
    const r = parseShelfLife('90日');
    expect(r.days).toBe(90);
    expect(r.parseError).toBe(false);
  });

  it('"180日（夏期）" → 180', () => {
    const r = parseShelfLife('180日（夏期）');
    expect(r.days).toBe(180);
    expect(r.parseError).toBe(false);
  });

  it('"９０日" (全角数字) → 90', () => {
    const r = parseShelfLife('９０日');
    expect(r.days).toBe(90);
    expect(r.parseError).toBe(false);
  });

  it('空文字 → parseError=true', () => {
    const r = parseShelfLife('');
    expect(r.parseError).toBe(true);
    expect(r.days).toBe(0);
  });

  it('"不明" → parseError=true', () => {
    const r = parseShelfLife('不明');
    expect(r.parseError).toBe(true);
  });
});
