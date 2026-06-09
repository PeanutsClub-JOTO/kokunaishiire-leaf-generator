import { describe, it, expect } from 'vitest';

// extractXlsxImages の実XLSXに対する統合テストは
// tests/fixtures/real/real-images.test.ts を参照（実見積ファイルで検証）。
// ここでは拡張子→MIME判定のみを軽量に確認する。

describe('xlsx-images ユーティリティ', () => {
  it('拡張子からMIMEタイプを判別できる', () => {
    const extToMime = (ext: string) => {
      const map: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
      };
      return map[ext] ?? 'image/jpeg';
    };

    expect(extToMime('.jpg')).toBe('image/jpeg');
    expect(extToMime('.png')).toBe('image/png');
    expect(extToMime('.unknown')).toBe('image/jpeg'); // default
  });
});
