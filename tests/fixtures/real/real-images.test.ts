import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractXlsxImages } from '../../../lib/import/xlsx-images';

/**
 * 実XLSXの埋め込み画像抽出に対する回帰テスト。
 * 位置ヒューリスティックは廃止したので、ここでは以下だけを確認する:
 *  - 全ての埋め込み画像を抜けなく回収する（枚数）
 *  - 各画像がシート名・実体バッファを持つ
 *  - 商品との紐付けは image-matching.ts の担当（周辺テキスト＋LLM）
 */
const has = (file: string) => fs.existsSync(path.join(__dirname, file));

describe.skipIf(!has('kanazawa.xlsx'))('実XLSX画像抽出: 金澤兼六製菓 (kanazawa.xlsx)', () => {
  it('埋め込み画像を全て回収する（12商品分＋ロゴ）', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'kanazawa.xlsx'));
    const res = await extractXlsxImages(buf);

    expect(res.images.length).toBeGreaterThanOrEqual(12);
    expect(res.images.every((i) => i.sheetName === '御見積書_01')).toBe(true);
    expect(res.images.every((i) => i.buffer.length > 0)).toBe(true);
  });
});

describe.skipIf(!has('hokushin.xlsx'))('実XLSX画像抽出: 北辰フーズ (hokushin.xlsx, 3シート)', () => {
  it('シート別に画像を回収する', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'hokushin.xlsx'));
    const res = await extractXlsxImages(buf);

    const bySheet = (name: string) =>
      res.images.filter((i) => i.sheetName === name).length;

    expect(bySheet('御見積書_01')).toBeGreaterThanOrEqual(12);
    expect(bySheet('御見積書_02')).toBeGreaterThanOrEqual(12);
    expect(bySheet('御見積書_03')).toBeGreaterThanOrEqual(9);
  });
});
