import { describe, expect, it } from 'vitest';
import type { RawProductRow, RawSheetData } from './xlsx-cells';
import { classifyWorkbookRole, mergeWorkbookBundle } from './multi-file-bundle';
import type { ExtractedImage } from './xlsx-images';

function row(overrides: Partial<RawProductRow>): RawProductRow {
  return {
    no: null,
    maker_name: null,
    product_name: overrides.product_name ?? '商品',
    spec_raw: null,
    spec_pieces: null,
    spec_grams: null,
    irisu_raw: null,
    case_qty: null,
    lots_per_kou: null,
    min_lot_raw: null,
    min_lot_qty: null,
    retail_price: null,
    cost: null,
    jan_code: null,
    product_code: null,
    shelf_life_days: null,
    sales_period_raw: null,
    sales_period_start: null,
    sales_period_end: null,
    piece_size: null,
    note: null,
    parse_errors: [],
    source_row: null,
    source_col: null,
    ...overrides,
  };
}

function sheet(products: RawProductRow[], sheetName = 'Sheet1'): RawSheetData {
  return { sheet_name: sheetName, maker_name: null, products };
}

function image(
  mediaPath: string,
  no: number | null,
  overrides: Partial<ExtractedImage> = {},
): ExtractedImage {
  return {
    no,
    sheetName: 'Sheet1',
    mediaPath,
    mimeType: 'image/png',
    buffer: Buffer.from(mediaPath),
    anchorRow: 20,
    anchorCol: 1,
    mappingStrategy: 'number_grid',
    ...overrides,
  };
}

describe('multi-file workbook bundle', () => {
  it('classifies quotation, catalog, and order files', () => {
    expect(
      classifyWorkbookRole('銀の汐　見積書2026年5月.xlsx', [
        sheet([row({ product_name: '商品A', cost: 10 })]),
      ]),
    ).toBe('quotation');
    expect(
      classifyWorkbookRole('銀の汐商品リスト -2026.5.xlsx', [
        sheet([row({ product_name: '商品A', jan_code: '4962407015031' })]),
      ]),
    ).toBe('catalog');
    expect(
      classifyWorkbookRole('銀の汐　発注書2026.5月.xlsx', [
        sheet([row({ product_name: '商品A', case_qty: 12 })]),
      ]),
    ).toBe('order');
  });

  it('uses quotation rows as primary and fills missing catalog details by JAN', () => {
    const quote = sheet([
      row({
        product_name: '(新)リッチバタークッキー',
        jan_code: '4962407015031',
        irisu_raw: '100×6袋×2合',
        case_qty: 100,
        lots_per_kou: 12,
        retail_price: 10,
        cost: 6,
      }),
    ]);
    const catalog = sheet([
      row({
        product_name: 'リッチバタークッキー',
        jan_code: '4962407015031',
        shelf_life_days: 365,
        piece_size: 'W100×D50×H30',
      }),
    ]);

    const result = mergeWorkbookBundle([
      { fileName: '銀の汐　見積書2026年5月.xlsx', sheets: [quote], images: [] },
      {
        fileName: '銀の汐商品リスト -2026.5.xlsx',
        sheets: [catalog],
        images: [image('catalog-image', 1)],
      },
    ]);

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].products).toHaveLength(1);
    expect(result.sheets[0].products[0].cost).toBe(6);
    expect(result.sheets[0].products[0].shelf_life_days).toBe(365);
    expect(result.sheets[0].products[0].piece_size).toBe('W100×D50×H30');
    expect(result.productImages).toHaveLength(1);
    expect(result.productImages[0].image.mediaPath).toBe('catalog-image');
  });

  it('links horizontal catalog images by product column before sheet order', () => {
    const quote = sheet([
      row({ product_name: '商品A', jan_code: '1111111111111', cost: 100 }),
      row({ product_name: '商品B', jan_code: '2222222222222', cost: 100 }),
      row({ product_name: '商品C', jan_code: '3333333333333', cost: 100 }),
    ]);
    const catalog = sheet([
      row({
        product_name: '商品A',
        jan_code: '1111111111111',
        source_row: 12,
        source_col: 2,
      }),
      row({
        product_name: '商品B',
        jan_code: '2222222222222',
        source_row: 12,
        source_col: 12,
      }),
      row({
        product_name: '商品C',
        jan_code: '3333333333333',
        source_row: 12,
        source_col: 22,
      }),
    ]);

    const result = mergeWorkbookBundle([
      { fileName: '見積書.xlsx', sheets: [quote], images: [] },
      {
        fileName: '商品リスト.xlsx',
        sheets: [catalog],
        images: [
          image('image-for-c', null, {
            anchorRow: 5,
            anchorCol: 23,
            mappingStrategy: 'inline_anchor',
          }),
        ],
      },
    ]);

    expect(result.productImages).toHaveLength(1);
    expect(result.productImages[0].sourceIndex).toBe(2);
    expect(result.productImages[0].image.mediaPath).toBe('image-for-c');
  });

  it('fills missing catalog details and carries images by product code when JAN is missing', () => {
    const quote = sheet([
      row({
        product_name: 'チョコクッキー',
        product_code: 'AB-1234',
        cost: 80,
      }),
    ]);
    const catalog = sheet([
      row({
        product_name: 'チョコクッキー',
        product_code: ' ab 1234 ',
        shelf_life_days: 180,
        source_row: 12,
        source_col: 2,
      }),
    ]);

    const result = mergeWorkbookBundle([
      { fileName: '見積書.xlsx', sheets: [quote], images: [] },
      {
        fileName: '商品リスト.xlsx',
        sheets: [catalog],
        images: [image('code-match-image', null, { anchorRow: 12, anchorCol: 2 })],
      },
    ]);

    expect(result.sheets[0].products).toHaveLength(1);
    expect(result.sheets[0].products[0].shelf_life_days).toBe(180);
    expect(result.productImages).toHaveLength(1);
    expect(result.productImages[0].image.mediaPath).toBe('code-match-image');
  });

  it('does not merge same-name products when both sides have different product codes', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [
          sheet([
            row({
              product_name: 'ミックスナッツ',
              product_code: 'A-001',
              cost: 100,
            }),
          ]),
        ],
        images: [],
      },
      {
        fileName: '商品リスト.xlsx',
        sheets: [
          sheet([
            row({
              product_name: 'ミックスナッツ',
              product_code: 'B-001',
              shelf_life_days: 180,
            }),
          ]),
        ],
        images: [],
      },
    ]);

    expect(result.sheets[0].products).toHaveLength(1);
    expect(result.sheets[0].products[0].shelf_life_days).toBeNull();
  });

  it('does not carry images through fuzzy name-only support matches', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [sheet([row({ product_name: '銀汐 ナッツミックス', cost: 100 })])],
        images: [],
      },
      {
        fileName: '商品リスト.xlsx',
        sheets: [
          sheet([
            row({
              product_name: 'ナッツミックス',
              shelf_life_days: 180,
              source_row: 12,
              source_col: 2,
            }),
          ]),
        ],
        images: [image('fuzzy-image', null, { anchorRow: 12, anchorCol: 2 })],
      },
    ]);

    expect(result.sheets[0].products[0].shelf_life_days).toBe(180);
    expect(result.productImages).toHaveLength(0);
  });

  it('does not add catalog-only products when quotation rows exist', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [sheet([row({ product_name: '商品A', jan_code: '1111111111111', cost: 100 })])],
        images: [],
      },
      {
        fileName: '商品リスト.xlsx',
        sheets: [sheet([row({ product_name: '商品B', jan_code: '2222222222222' })])],
        images: [],
      },
    ]);

    expect(result.sheets[0].products).toHaveLength(1);
    expect(result.sheets[0].products[0].product_name).toBe('商品A');
  });

  it('does not merge different quotation products only because names partially match', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [
          sheet([
            row({ product_name: 'チャンククッキー', cost: 50 }),
            row({ product_name: 'いちごのチャンククッキー', cost: 50 }),
          ]),
        ],
        images: [],
      },
    ]);

    expect(result.sheets[0].products.map((product) => product.product_name)).toEqual([
      'チャンククッキー',
      'いちごのチャンククッキー',
    ]);
  });

  it('keeps duplicate quotation names separate when JAN is missing', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [
          sheet([
            row({ product_name: 'アソートゼリー', spec_raw: '6個入', cost: 100 }),
            row({ product_name: 'アソートゼリー', spec_raw: '12個入', cost: 180 }),
          ]),
        ],
        images: [],
      },
    ]);

    expect(result.sheets[0].products).toHaveLength(2);
    expect(result.sheets[0].products.map((product) => product.spec_raw)).toEqual([
      '6個入',
      '12個入',
    ]);
  });

  it('does not fill catalog details by name when quotation name is ambiguous', () => {
    const result = mergeWorkbookBundle([
      {
        fileName: '見積書.xlsx',
        sheets: [
          sheet([
            row({ product_name: 'アソートゼリー', spec_raw: '6個入', cost: 100 }),
            row({ product_name: 'アソートゼリー', spec_raw: '12個入', cost: 180 }),
          ]),
        ],
        images: [],
      },
      {
        fileName: '商品リスト.xlsx',
        sheets: [
          sheet([
            row({
              product_name: 'アソートゼリー',
              shelf_life_days: 365,
            }),
          ]),
        ],
        images: [],
      },
    ]);

    expect(result.sheets[0].products).toHaveLength(2);
    expect(result.sheets[0].products.map((product) => product.shelf_life_days)).toEqual([
      null,
      null,
    ]);
  });
});
