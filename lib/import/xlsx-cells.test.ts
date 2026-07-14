import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { extractXlsxCells } from './xlsx-cells';
import { KANAZAWA_PRODUCTS } from '../../tests/fixtures/kanazawa';

// テスト用の XLSX バッファを生成するヘルパー
function createMockXlsxBuffer(data: unknown[][], sheetName = 'Sheet1', merges: XLSX.Range[] = []): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(data);
  if (merges.length > 0) ws['!merges'] = merges;
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

  it('最小ロットが空欄の場合は入数を1ロットとして扱う', () => {
    const data = [
      ['No.', '品名', '入数', '単価', '上代'],
      ['1', 'テスト商品', '12', 400, 600],
      ['2', '甲あり商品', '12×4', 400, 600],
    ];

    const buffer = createMockXlsxBuffer(data);
    const result = extractXlsxCells(buffer);

    expect(result[0].products[0].min_lot_qty).toBe(12);
    expect(result[0].products[1].min_lot_qty).toBe(48);
    expect(result[0].products[0].parse_errors).not.toContain('minlot_parse_error');
  });

  it('結合された商品名範囲からメーカー名と具体的な品名を分離できる', () => {
    const data = [
      [''],
      ['商品名', '', '', '規格', 'JANコード', '入数', '上代', '単価（税抜）', '賞味期限', '備考'],
      ['アサヒ飲料', 'カルピス（希釈）', '', '470ml', '4901340184527', '15', '¥520', '¥310', '9ヵ月', ''],
      ['アサヒ飲料', 'カルピス糖質60％オフ（希釈）', '', '470ml', '4901340074341', '12', '¥520', '¥310', '9ヵ月', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['【定番品】', '', '【季節商品】', '', '', '', '', '', '季節品販売期間(目安)：発売～3､4ヶ月', ''],
    ];
    const buffer = createMockXlsxBuffer(data, 'アサヒ飲料', [
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    ]);

    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.maker_name).toBe('アサヒ飲料');
    expect(sheet.products).toHaveLength(2);
    expect(sheet.products[0].maker_name).toBe('アサヒ飲料');
    expect(sheet.products[0].product_name).toBe('カルピス（希釈）');
    expect(sheet.products[0].cost).toBe(310);
    expect(sheet.products[0].retail_price).toBe(520);
    expect(sheet.products[0].case_qty).toBe(15);
    expect(sheet.products[0].shelf_life_days).toBe(270);
    expect(sheet.products[1].product_name).toBe('カルピス糖質60％オフ（希釈）');
  });

  it('注意書きの卸単価に惑わされず、2段ヘッダーの見積書を抽出できる', () => {
    const data = [
      ['', '', '', '納品場所：事前協議※納品場所により卸単価変更の場合有り'],
      [],
      ['', '', '', '', '', '', '', '', '', '価格'],
      ['№', 'メーカー', '発売日', '商品名', '規格', 'ＪＡＮコード', '入数', '発注ロット', '賞味期限', '参考売価', '', '', '推奨売価', '', '', 'ＮＥＴ価格'],
      ['', '', '', '', '', '', '', '', '日', '税抜', '税込', '', '税抜', '税込', '', '税抜'],
      ['1', 'バルエジャパン', '', 'かぶりつきチキン　うましお味', '1本(80g）', '4582291210932', '60（5×12）', '混載10cs～', '365', '300', '324', '', '298', '321', '', '175'],
      ['2', 'バルエジャパン', '', 'かぶりつきチキン　テリヤキ味', '1本(80g）', '458-2291-210949', '60（5×12）', '混載10cs～', '365', '300', '324', '', '298', '321', '', '175'],
    ];
    const buffer = createMockXlsxBuffer(data, '見積書', [
      { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
      { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
      { s: { r: 3, c: 3 }, e: { r: 4, c: 3 } },
      { s: { r: 3, c: 4 }, e: { r: 4, c: 4 } },
      { s: { r: 3, c: 5 }, e: { r: 4, c: 5 } },
      { s: { r: 3, c: 6 }, e: { r: 4, c: 6 } },
      { s: { r: 3, c: 7 }, e: { r: 4, c: 7 } },
      { s: { r: 3, c: 9 }, e: { r: 3, c: 10 } },
      { s: { r: 3, c: 12 }, e: { r: 3, c: 13 } },
    ]);

    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.products).toHaveLength(2);
    expect(sheet.products[0].product_name).toBe('かぶりつきチキン　うましお味');
    expect(sheet.products[0].maker_name).toBe('バルエジャパン');
    expect(sheet.products[0].case_qty).toBe(60);
    expect(sheet.products[0].lots_per_kou).toBe(1);
    expect(sheet.products[0].min_lot_qty).toBe(600);
    expect(sheet.products[0].retail_price).toBe(300);
    expect(sheet.products[0].cost).toBe(175);
    expect(sheet.products[1].jan_code).toBe('4582291210949');
  });

  it('ヘッダー下段を商品として抽出せず、結合セルの上代を補完できる', () => {
    const data = [
      ['上代', '商品名', 'JANコード', '入数', '規格', '単価', '賞味期限'],
      ['', '', '', '', '', '', ''],
      ['', '', '', '', '', '', ''],
      ['10円', '(新)リッチバタークッキー', '4962407015031', '100×6袋×2合', '1枚', '6', '365日'],
      ['', '(新)ミックスハニー', '4962407010463', '50×8袋', '6個', '11', '180日'],
    ];
    const buffer = createMockXlsxBuffer(data, '銀の汐商品', [
      { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 2, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 2, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 2, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 2, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 2, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 2, c: 6 } },
      { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    ]);

    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.products).toHaveLength(2);
    expect(sheet.products[0].product_name).toBe('(新)リッチバタークッキー');
    expect(sheet.products[0].retail_price).toBe(10);
    expect(sheet.products[0].case_qty).toBe(100);
    expect(sheet.products[0].lots_per_kou).toBe(12);
    expect(sheet.products[1].product_name).toBe('(新)ミックスハニー');
    expect(sheet.products[1].retail_price).toBe(10);
  });

  it('表ヘッダーがない商品リスト型でもJANカードから商品を抽出できる', () => {
    const data = [
      ['銀の汐　商品リスト'],
      [],
      ['JAN:4962407015031', '', 'JAN:4962407010470'],
      ['10円リッチバタークッキー', '', '20円ひとくちソースカツ'],
      ['入数:100*6袋*2合 賞味365日', '', '入数:50*8袋 賞味:180日'],
    ];
    const buffer = createMockXlsxBuffer(data, '銀汐');

    const result = extractXlsxCells(buffer);
    const sheet = result[0];

    expect(sheet.products).toHaveLength(2);
    expect(sheet.products[0].product_name).toBe('リッチバタークッキー');
    expect(sheet.products[0].retail_price).toBe(10);
    expect(sheet.products[0].jan_code).toBe('4962407015031');
    expect(sheet.products[0].case_qty).toBe(100);
    expect(sheet.products[0].lots_per_kou).toBe(12);
    expect(sheet.products[0].shelf_life_days).toBe(365);
    expect(sheet.products[1].product_name).toBe('ひとくちソースカツ');
    expect(sheet.products[1].retail_price).toBe(20);
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
      ['GTINコード'],
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

  describe('商品コード列 - すべてのエイリアスでコードを取得できる', () => {
    it.each([
      ['商品コード'],
      ['商品CD'],
      ['品番'],
      ['品目コード'],
      ['メーカー品番'],
      ['型番'],
      ['管理番号'],
    ])('エイリアス "%s"', (alias) => {
      const data = [
        ['No.', '品名', alias],
        ['1', 'テスト商品', ' AB-1234 '],
      ];
      const buf = createMockXlsxBuffer(data);
      const result = extractXlsxCells(buf);
      expect(result[0].products[0].product_code).toBe('AB1234');
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
