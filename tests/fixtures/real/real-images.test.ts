import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractXlsxImages } from '../../../lib/import/xlsx-images';

/**
 * 実XLSXの埋め込み画像抽出に対する回帰テスト。
 *
 * 実ファイルが暴いた以下のバグの再発を防ぐ:
 *  - 画像が oneCellAnchor で配置される（twoCellAnchor のみ対応では0枚になる）
 *  - 商品①〜⑥は同一行・列違いで並ぶ（行で商品を分ける旧ロジックは誤り）
 *  - 先頭のロゴ画像（最上部行）を商品として誤検出しない
 *  - マルチシート（御見積書_01/02/03）で No. をシート単位に採番する
 */
// 実顧客データは .gitignore 済み。存在しない環境ではスキップする。
const has = (file: string) => fs.existsSync(path.join(__dirname, file));

describe.skipIf(!has('kanazawa.xlsx'))('実XLSX画像抽出: 金澤兼六製菓 (kanazawa.xlsx)', () => {
  it('12商品の画像をNo.1〜12で抽出し、ロゴは除外する', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'kanazawa.xlsx'));
    const res = await extractXlsxImages(buf);

    expect(res.images).toHaveLength(12);
    expect(res.images.map((i) => i.no).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // 全画像が同一シートに属し、実体を持つ
    expect(res.images.every((i) => i.sheetName === '御見積書_01')).toBe(true);
    expect(res.images.every((i) => i.buffer.length > 0)).toBe(true);
    // ロゴ（最上部行）は unmatched として除外
    expect(res.unmatched.length).toBeGreaterThanOrEqual(1);
    expect(res.unmatched.every((u) => u.anchorRow < 20)).toBe(true);
  });
});

describe.skipIf(!has('hokushin.xlsx'))('実XLSX画像抽出: 北辰フーズ (hokushin.xlsx, 3シート)', () => {
  it('シートごとにNo.を採番する（01:12枚 / 02:12枚 / 03:9枚）', async () => {
    const buf = fs.readFileSync(path.join(__dirname, 'hokushin.xlsx'));
    const res = await extractXlsxImages(buf);

    const bySheet = (name: string) =>
      res.images.filter((i) => i.sheetName === name).map((i) => i.no).sort((a, b) => a - b);

    expect(bySheet('御見積書_01')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(bySheet('御見積書_02')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(bySheet('御見積書_03')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 各シートのロゴが除外される
    expect(res.unmatched).toHaveLength(3);
  });
});
