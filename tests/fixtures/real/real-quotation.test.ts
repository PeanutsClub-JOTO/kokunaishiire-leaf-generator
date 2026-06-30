import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { extractXlsxCells, type RawProductRow, type RawSheetData } from '../../../lib/import/xlsx-cells';

/**
 * 実見積データに対する回帰テスト。
 *
 * 実ファイルが暴いた以下のバグの再発を防ぐ:
 *  A. ヘッダー「№」(U+2116) 未対応 → no が全件 null（画像紐付け不能）
 *  B. 全角「ＪＡＮコード」未対応 → jan が全件 null
 *  C. 日付の toISOString() による1日ズレ（dateStr 側で修正済み）
 *
 * CSV は UTF-8 として読み、実運用と同じ xlsx バッファに変換してから検証する。
 */
// 実顧客データは .gitignore 済み。存在しない環境（クリーンチェックアウト/CI）では
// テストをスキップする。
const has = (file: string) => fs.existsSync(path.join(__dirname, file));

function loadReal(file: string): RawProductRow[] {
  if (!has(file)) return [];
  const csv = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  const wb = XLSX.read(csv, { type: 'string' });
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const sheets = extractXlsxCells(xlsxBuf);
  return sheets.flatMap((s) => s.products);
}

function loadRealXlsx(file: string): RawSheetData[] {
  if (!has(file)) return [];
  const buf = fs.readFileSync(path.join(__dirname, file));
  return extractXlsxCells(buf);
}

const ymd = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

describe.skipIf(!has('kanazawa.csv'))('実見積: 金澤兼六製菓 (kanazawa.csv)', () => {
  const products = loadReal('kanazawa.csv');

  it('12商品すべて抽出できる', () => {
    expect(products).toHaveLength(12);
  });

  it('№ヘッダーから商品No.を1〜12で取得できる（画像紐付けの前提）', () => {
    expect(products.map((p) => p.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('全角ＪＡＮコード列を取得できる', () => {
    expect(products[0].jan_code).toBe('4932123119658');
    expect(products.every((p) => /^\d{13}$/.test(p.jan_code ?? ''))).toBe(true);
  });

  it('①の主要項目を正確に転記できる', () => {
    const p = products[0];
    expect(p.product_name).toBe('YL-6P塩レモンゼリーギフト');
    expect(p.maker_name).toBe('金澤兼六製菓');
    expect(p.spec_pieces).toBe(6);
    expect(p.case_qty).toBe(12);
    expect(p.lots_per_kou).toBe(1);
    expect(p.min_lot_qty).toBe(12);   // 1ｹｰｽ = 12×1
    expect(p.cost).toBe(400);
    expect(p.retail_price).toBe(1000);
    expect(p.shelf_life_days).toBe(180);
    expect(ymd(p.sales_period_start)).toBe('2026-03-01'); // 1日ズレ無し
    expect(ymd(p.sales_period_end)).toBe('2026-08-31');
    expect(p.parse_errors).toEqual([]);
  });

  it('②の最小ロット（2ｹｰｽ×16入）を正しく算出できる', () => {
    const p = products[1];
    expect(p.case_qty).toBe(16);
    expect(p.min_lot_qty).toBe(32); // 2ｹｰｽ = 16×2
  });

  it('商品画像エリアからピース寸法(商品サイズ)を商品No.ごとに転記できる', () => {
    expect(products[0].piece_size).toBe('W170×D62×H240'); // ①
    expect(products[1].piece_size).toBe('W255×D195×H60'); // ②
    expect(products[11].piece_size).toBe('W235×D386×H64'); // ⑫
  });

  it('全商品に parse_errors がない', () => {
    const withErrors = products.filter((p) => p.parse_errors.length > 0);
    expect(withErrors).toHaveLength(0);
  });
});

describe.skipIf(!has('hokushin.csv'))('実見積: 北辰フーズ (hokushin.csv)', () => {
  const products = loadReal('hokushin.csv');

  it('12商品すべて抽出でき、No.が1〜12', () => {
    expect(products).toHaveLength(12);
    expect(products.map((p) => p.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('①の規格(125g)・1甲(15×4=60)・賞味240日を転記できる', () => {
    const p = products[0];
    expect(p.spec_grams).toBe(125);
    expect(p.case_qty).toBe(15);
    expect(p.lots_per_kou).toBe(4);
    expect(p.min_lot_qty).toBe(60); // 1甲 = 15×4
    expect(p.shelf_life_days).toBe(240);
  });

  it('⑦の販売期間が1日ズレ無しで転記される', () => {
    const p = products[6];
    expect(ymd(p.sales_period_start)).toBe('2026-04-17');
    expect(ymd(p.sales_period_end)).toBe('2026-07-31');
  });
});

// ─── 北辰フーズ v2 (hokushin2.xlsx 3シート構成) ─────────────────────────────
//
// hokushin2.xlsx は実際の .xlsx ファイルとして存在する（CSV 経由でない）。
// ヘッダー列が広い範囲に分散しており（A列〜FI列=164列）、
// 「賞味期間(夏期)」エイリアスや「最小ﾛｯﾄ（半角カナ）」など複数の表記揺れを検証する。

describe.skipIf(!has('hokushin2.xlsx'))('実見積: 北辰フーズ v2 (hokushin2.xlsx / 3シート)', () => {
  const sheets = loadRealXlsx('hokushin2.xlsx');

  it('3シートをすべて抽出できる', () => {
    expect(sheets).toHaveLength(3);
  });

  it('各シートの商品数が正しい（12・12・9）', () => {
    expect(sheets.map((s) => s.products.length)).toEqual([12, 12, 9]);
  });

  it('各シートの商品Noが1からの連番になっている', () => {
    expect(sheets[0].products.map((p) => p.no)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(sheets[1].products.map((p) => p.no)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(sheets[2].products.map((p) => p.no)).toEqual([1,2,3,4,5,6,7,8,9]);
  });

  it('全角ＪＡＮコード列（ＪＡＮコード表記）を取得できる', () => {
    const allProducts = sheets.flatMap((s) => s.products);
    expect(allProducts.every((p) => /^\d{13}$/.test(p.jan_code ?? ''))).toBe(true);
    // シート01 ①
    expect(sheets[0].products[0].jan_code).toBe('4582179291442');
  });

  it('シート01 ① の主要項目を正確に転記できる', () => {
    const p = sheets[0].products[0];
    expect(p.product_name).toBe('涼ごこち福岡県産あまおう苺ゼリー');
    expect(p.maker_name).toBe('北辰フーズ');
    expect(p.cost).toBe(150);
    expect(p.case_qty).toBe(15);
    expect(p.lots_per_kou).toBe(4);
    expect(p.min_lot_qty).toBe(60); // 1甲 = 15×4
    expect(p.shelf_life_days).toBe(240);
    expect(p.parse_errors).toEqual([]);
  });

  it('シート02 ① の主要項目を正確に転記できる', () => {
    const p = sheets[1].products[0];
    expect(p.product_name).toBe('愛媛県産せとかひとくちゼリー');
    expect(p.cost).toBe(260);
    expect(p.case_qty).toBe(12);
    expect(p.lots_per_kou).toBe(4);
    expect(p.min_lot_qty).toBe(48); // 1甲 = 12×4
    expect(p.shelf_life_days).toBe(180);
    expect(p.parse_errors).toEqual([]);
  });

  it('シート03 ① の主要項目を正確に転記できる', () => {
    const p = sheets[2].products[0];
    expect(p.product_name).toBe('岡山白桃カステラ');
    expect(p.cost).toBe(225);
    expect(p.case_qty).toBe(12);
    expect(p.lots_per_kou).toBe(6);
    expect(p.min_lot_qty).toBe(72); // 1甲 = 12×6
    expect(p.shelf_life_days).toBe(180);
    expect(p.parse_errors).toEqual([]);
  });

  it('商品画像エリアからピース寸法を各商品に紐付けできる', () => {
    // シート01
    expect(sheets[0].products[0].piece_size).toBe('W73×D73×H73');  // ①
    expect(sheets[0].products[4].piece_size).toBe('W160×D160×H55'); // ⑤
    // シート02
    expect(sheets[1].products[0].piece_size).toBe('W160×D160×H55'); // ①
    // シート03
    expect(sheets[2].products[0].piece_size).toBe('W165×D55×H100'); // ①
    expect(sheets[2].products[6].piece_size).toBe('W170×D60×H80');  // ⑦
  });

  it('全シート・全商品に parse_errors がない', () => {
    const allProducts = sheets.flatMap((s) => s.products);
    const withErrors = allProducts.filter((p) => p.parse_errors.length > 0);
    expect(withErrors).toHaveLength(0);
  });
});
