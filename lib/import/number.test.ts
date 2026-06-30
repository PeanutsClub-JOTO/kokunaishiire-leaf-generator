import { describe, expect, it } from 'vitest';
import { parseLooseNumber } from './number';

describe('parseLooseNumber', () => {
  it('通貨記号・円表記・全角数字・カンマを含む金額を数値化する', () => {
    expect(parseLooseNumber('￥４００')).toBe(400);
    expect(parseLooseNumber('1,250円')).toBe(1250);
    expect(parseLooseNumber('税込 3,000')).toBe(3000);
  });

  it('数値化できない値はnullを返す', () => {
    expect(parseLooseNumber('未定')).toBeNull();
    expect(parseLooseNumber(null)).toBeNull();
  });
});
