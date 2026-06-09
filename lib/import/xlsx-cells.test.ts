import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractXlsxCells } from './xlsx-cells';
import { KANAZAWA_PRODUCTS } from '../../tests/fixtures/kanazawa';

// テスト用の XLSX バッファを生成するヘルパー
function createMockXlsxBuffer(data: any[][], sheetName = 'Sheet1'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return out;
}

describe('extractXlsxCells', () => {
  it('ヘッダー行を動的に検出し、商品データを正しく抽出できる', () => {
    const data = [
      ['何か関係ないテキスト', '', ''],
      ['', '日付', '2026/05/29'],
      [], // 空行
      ['No.', '品名', 'メーカー', '規格', '入数', '最小ロット', '単価', '上代', '賞味期限', '販売期間', 'JANコード', '備考'],
      [
        '①', 
        KANAZAWA_PRODUCTS[0].product_name, 
        KANAZAWA_PRODUCTS[0].maker_name, 
        KANAZAWA_PRODUCTS[0].spec_raw, 
        KANAZAWA_PRODUCTS[0].irisu_raw, 
        KANAZAWA_PRODUCTS[0].min_lot_raw, 
        KANAZAWA_PRODUCTS[0].cost, 
        KANAZAWA_PRODUCTS[0].retail_price, 
        '180日', 
        KANAZAWA_PRODUCTS[0].sales_period_raw, 
        KANAZAWA_PRODUCTS[0].jan_code, 
        ''
      ],
      [
        '②', 
        KANAZAWA_PRODUCTS[1].product_name, 
        KANAZAWA_PRODUCTS[1].maker_name, 
        KANAZAWA_PRODUCTS[1].spec_raw, 
        KANAZAWA_PRODUCTS[1].irisu_raw, 
        KANAZAWA_PRODUCTS[1].min_lot_raw, 
        KANAZAWA_PRODUCTS[1].cost, 
        KANAZAWA_PRODUCTS[1].retail_price, 
        '180日', 
        KANAZAWA_PRODUCTS[1].sales_period_raw, 
        KANAZAWA_PRODUCTS[1].jan_code, 
        ''
      ],
    ];

    const buffer = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buffer);

    expect(result).toHaveLength(1);
    const sheet = result[0];
    expect(sheet.sheet_name).toBe('Sheet1');
    
    // メーカー名はシート内の最初の商品から補完されているはず
    expect(sheet.maker_name).toBe('金澤兼六製菓');
    expect(sheet.products).toHaveLength(2);

    const p1 = sheet.products[0];
    expect(p1.no).toBe(1);
    expect(p1.product_name).toBe('YL-6P塩レモン');
    expect(p1.spec_pieces).toBe(6);
    expect(p1.case_qty).toBe(12);
    expect(p1.lots_per_kou).toBe(1);
    expect(p1.min_lot_qty).toBe(12);
    expect(p1.cost).toBe(400);
    expect(p1.retail_price).toBe(600);
    expect(p1.shelf_life_days).toBe(180);
    expect(p1.sales_period_start).toEqual(new Date(2026, 3, 17));
    expect(p1.sales_period_end).toEqual(new Date(2026, 6, 31));
    expect(p1.parse_errors).toEqual([]);

    const p2 = sheet.products[1];
    expect(p2.no).toBe(2);
    expect(p2.product_name).toBe('ICR-7P水羊羹');
    expect(p2.spec_pieces).toBe(7);
    expect(p2.case_qty).toBe(16);
    expect(p2.lots_per_kou).toBe(2);
    expect(p2.min_lot_qty).toBe(32);
    expect(p2.cost).toBe(465);
    expect(p2.retail_price).toBe(700);
    expect(p2.shelf_life_days).toBe(180);
    expect(p2.sales_period_start).toEqual(new Date(2026, 3, 17));
    expect(p2.sales_period_end).toEqual(new Date(2026, 6, 31));
    expect(p2.parse_errors).toEqual([]);
  });

  it('上代と原価が逆転している場合はエラーフラグが立つ', () => {
    const data = [
      ['No.', '品名', '単価', '上代'],
      ['1', 'テスト商品', 1000, 500], // 原価1000, 上代500
    ];

    const buffer = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.products).toHaveLength(1);
    const p1 = sheet.products[0];
    expect(p1.cost).toBe(1000);
    expect(p1.retail_price).toBe(500);
    expect(p1.parse_errors).toContain('cost_retail_inverted');
  });

  it('ヘッダーが見つからない場合は空のリストを返す', () => {
    const data = [
      ['単なるデータ', 'だけ', 'で'],
      ['ヘッダー', 'が', 'ない'],
    ];

    const buffer = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.products).toHaveLength(0);
  });
});
