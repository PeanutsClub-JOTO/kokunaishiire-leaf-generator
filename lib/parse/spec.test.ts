import { describe, it, expect } from 'vitest';
import { parseSpec, specMatches } from './spec';

describe('parseSpec', () => {
  it('"6個" → {specPieces:6, specGrams:null}', () => {
    const r = parseSpec('6個');
    expect(r.specPieces).toBe(6);
    expect(r.specGrams).toBeNull();
    expect(r.parseError).toBe(false);
  });

  it('"9個" → {specPieces:9, specGrams:null}', () => {
    const r = parseSpec('9個');
    expect(r.specPieces).toBe(9);
    expect(r.specGrams).toBeNull();
  });

  it('"125g" → {specPieces:null, specGrams:125}', () => {
    const r = parseSpec('125g');
    expect(r.specPieces).toBeNull();
    expect(r.specGrams).toBe(125);
    expect(r.parseError).toBe(false);
  });

  it('"125G" (大文字) → {specGrams:125}', () => {
    const r = parseSpec('125G');
    expect(r.specGrams).toBe(125);
  });

  it('"６個" (全角数字) → {specPieces:6}', () => {
    const r = parseSpec('６個');
    expect(r.specPieces).toBe(6);
  });

  it('"125ｇ" (全角g) → {specGrams:125}', () => {
    const r = parseSpec('125ｇ');
    expect(r.specGrams).toBe(125);
  });

  it('"6ｺ" (全角コ) → {specPieces:6}', () => {
    const r = parseSpec('6ｺ');
    expect(r.specPieces).toBe(6);
  });

  it('"6個/125g" (両方含む) → {specPieces:6, specGrams:125}', () => {
    const r = parseSpec('6個/125g');
    expect(r.specPieces).toBe(6);
    expect(r.specGrams).toBe(125);
    expect(r.parseError).toBe(false);
  });

  it('"1枚" → {specPieces:1}', () => {
    const r = parseSpec('1枚');
    expect(r.specPieces).toBe(1);
    expect(r.parseError).toBe(false);
  });

  it('"470ml" → 容量として数値を保持する', () => {
    const r = parseSpec('470ml');
    expect(r.specGrams).toBe(470);
    expect(r.parseError).toBe(false);
  });

  it('空文字 → parseError=true', () => {
    const r = parseSpec('');
    expect(r.parseError).toBe(true);
    expect(r.specPieces).toBeNull();
    expect(r.specGrams).toBeNull();
  });

  it('"不明" → parseError=true', () => {
    const r = parseSpec('不明');
    expect(r.parseError).toBe(true);
  });
});

describe('specMatches', () => {
  it('同じspecPiecesは一致', () => {
    const a = parseSpec('6個');
    const b = parseSpec('6個');
    expect(specMatches(a, b)).toBe(true);
  });

  it('異なるspecPiecesは不一致', () => {
    const a = parseSpec('6個');
    const b = parseSpec('9個');
    expect(specMatches(a, b)).toBe(false);
  });

  it('同じspecGramsは一致', () => {
    const a = parseSpec('125g');
    const b = parseSpec('125g');
    expect(specMatches(a, b)).toBe(true);
  });

  it('piecesとgramsの型違いは不一致', () => {
    const a = parseSpec('6個');
    const b = parseSpec('125g');
    expect(specMatches(a, b)).toBe(false);
  });

  it('parseErrorがあれば不一致', () => {
    const a = { specPieces: 6, specGrams: null, parseError: true };
    const b = { specPieces: 6, specGrams: null, parseError: false };
    expect(specMatches(a, b)).toBe(false);
  });
});
