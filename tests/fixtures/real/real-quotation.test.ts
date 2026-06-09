import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { extractXlsxCells, type RawProductRow } from '../../../lib/import/xlsx-cells';

/**
 * 実見積データ（正氣屋製菓発行・ピーナッツクラブ宛）に対する回帰テスト。
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

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

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
