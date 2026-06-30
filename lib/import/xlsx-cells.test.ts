import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractXlsxCells } from './xlsx-cells';
import { KANAZAWA_PRODUCTS } from '../../tests/fixtures/kanazawa';

// テスト用の XLSX バッファを生成するヘルパー
function createMockXlsxBuffer(data: unknown[][], sheetName = 'Sheet1'): Buffer {
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
        '',
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
        '',
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

  it('単価・上代の通貨記号や全角数字を数値として抽出できる', () => {
    const data = [
      ['No.', '品名', '最小ロット', '単価', '上代'],
      ['1', 'テスト商品', '1ケース', '￥４００', '600円'],
    ];

    const buffer = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buffer);
    const p1 = result[0].products[0];

    expect(p1.cost).toBe(400);
    expect(p1.retail_price).toBe(600);
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

  // ─── ヘッダーエイリアス（it.each で全表記バリアント確認） ───────────────

  describe('No列 - すべてのエイリアスで商品Noを取得できる', () => {
    it.each([
      ['No.'],
      ['No'],
      ['NO'],
      ['NO.'],
      ['ＮＯ'],  // 全角→半角正規化で NO に一致
      ['№'],
      ['No．'], // 全角ピリオド→半角正規化で No. に一致
      ['番号'],
    ])('エイリアス "%s"', (alias) => {
      const data = [
        [alias, '品名', '単価'],
        ['①', 'テスト商品', 400],
      ];
      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products[0].no).toBe(1);
    });
  });

  describe('単価列 - すべてのエイリアスで原価を取得できる', () => {
    it.each([
      ['単価'],
      ['原価'],
      ['仕入単価'],
    ])('エイリアス "%s"', (alias) => {
      const data = [
        ['No.', '品名', alias],
        ['1', 'テスト商品', 400],
      ];
      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products[0].cost).toBe(400);
    });
  });

  describe('最小ロット列 - すべてのエイリアスで最小ロット文字列を取得できる', () => {
    it.each([
      ['最小ロット'],
      ['最小ﾛｯﾄ'],  // 半角カナ
      ['最小lot'],   // 英字混在
      ['ﾐﾆﾏﾑﾛｯﾄ'], // 半角カナのみ
    ])('エイリアス "%s"', (alias) => {
      const data = [
        ['No.', '品名', alias],
        ['1', 'テスト商品', '1ケース'],
      ];
      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products[0].min_lot_raw).toBe('1ケース');
    });
  });

  describe('JANコード列 - すべてのエイリアスでJANを取得できる', () => {
    it.each([
      ['JANコード'],
      ['JAN'],
      ['JANｺｰﾄﾞ'],     // 半角カナ混在
      ['ＪＡＮコード'], // 全角英字→半角正規化で JANコード に一致
      ['EAN'],
    ])('エイリアス "%s"', (alias) => {
      const data = [
        ['No.', '品名', alias],
        ['1', 'テスト商品', '4901234567890'],
      ];
      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products[0].jan_code).toBe('4901234567890');
    });
  });

  // ─── ヘッダー行位置の柔軟性 ──────────────────────────────────────────────

  describe('ヘッダー行位置 - 先頭30行以内であればどこでも検出できる', () => {
    it.each([0, 5, 15, 28])(
      'ヘッダーが %d 行目（0始まり）にある場合',
      (headerRowIndex) => {
        const data: unknown[][] = Array.from({ length: headerRowIndex }, () => []);
        data.push(['No.', '品名', '単価']);
        data.push(['1', 'テスト商品', 400]);

        const buf = createMockXlsxBuffer(data);
        const result = extractXlsxCells(buf);
        expect(result[0].products).toHaveLength(1);
        expect(result[0].products[0].cost).toBe(400);
      },
    );

    it('ヘッダーが31行目（0始まり）以降にある場合は抽出されない（検索範囲外）', () => {
      const data: unknown[][] = Array.from({ length: 31 }, () => []);
      data.push(['No.', '品名', '単価']);
      data.push(['1', 'テスト商品', 400]);

      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products).toHaveLength(0);
    });
  });

  // ─── 列順序の自由度 ──────────────────────────────────────────────────────

  it('列の並び順がどのような順序でも正しく各フィールドを取得できる', () => {
    // 単価 → 品名 → No. → 最小ロット の逆順配置
    const data = [
      ['単価', '品名', 'No.', '最小ロット'],
      [400, 'テスト商品', '①', '1ケース'],
    ];
    const buf = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buf);
    const p = result[0].products[0];
    expect(p.no).toBe(1);
    expect(p.product_name).toBe('テスト商品');
    expect(p.cost).toBe(400);
    expect(p.min_lot_raw).toBe('1ケース');
  });

  // ─── 行読み取り終了条件 ──────────────────────────────────────────────────

  it('「商品画像」テキストが行内に現れた時点で商品表の読み取りを終了する', () => {
    const data = [
      ['No.', '品名', '単価'],
      ['1', '商品A', 400],
      ['商品画像', '', ''],        // ここで終了
      ['2', '商品B（除外される）', 500],
    ];
    const buf = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buf);
    expect(result[0].products).toHaveLength(1);
    expect(result[0].products[0].product_name).toBe('商品A');
  });

  it('品名のない行が3行連続したら商品表の終端とみなす', () => {
    const data = [
      ['No.', '品名', '単価'],
      ['1', '商品A', 400],
      ['', '', ''],         // 空行 1
      ['', '', ''],         // 空行 2
      ['', '', ''],         // 空行 3 → 次の商品は読まない
      ['2', '商品B（除外される）', 500],
    ];
    const buf = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buf);
    expect(result[0].products).toHaveLength(1);
  });

  it('空行が2行以内なら途中の空行を飛ばして読み取りを続ける', () => {
    const data = [
      ['No.', '品名', '単価'],
      ['1', '商品A', 400],
      ['', '', ''],   // 空行 1
      ['', '', ''],   // 空行 2（まだ続く）
      ['2', '商品B', 500],
    ];
    const buf = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buf);
    expect(result[0].products).toHaveLength(2);
    expect(result[0].products[1].product_name).toBe('商品B');
  });

  // ─── マルチシート ─────────────────────────────────────────────────────────

  it('複数シートが存在する場合、それぞれを独立して抽出できる', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['No.', '品名', '単価'],
        ['1', '商品A', 400],
      ]),
      'シート1',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['No.', '品名', '単価'],
        ['1', '商品B', 500],
        ['2', '商品C', 600],
      ]),
      'シート2',
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const result = extractXlsxCells(buf);
    expect(result).toHaveLength(2);
    expect(result[0].sheet_name).toBe('シート1');
    expect(result[0].products).toHaveLength(1);
    expect(result[0].products[0].cost).toBe(400);
    expect(result[1].sheet_name).toBe('シート2');
    expect(result[1].products).toHaveLength(2);
    expect(result[1].products[1].cost).toBe(600);
  });

  it('一方のシートにヘッダーがなくても、他のシートは正しく抽出できる', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['ヘッダーなし', 'データ']]),
      'ヘッダー無し',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['No.', '品名', '単価'],
        ['1', '正常商品', 300],
      ]),
      '正常シート',
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const result = extractXlsxCells(buf);
    expect(result[0].products).toHaveLength(0);
    expect(result[1].products).toHaveLength(1);
    expect(result[1].products[0].product_name).toBe('正常商品');
  });
});
