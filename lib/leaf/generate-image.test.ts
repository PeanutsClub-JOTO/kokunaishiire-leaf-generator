import { describe, expect, it } from 'vitest';
import { buildLeafImageHtml, selectLeafTheme, type LeafletImageData } from './generate-image';

const baseData: LeafletImageData = {
  id: 'leaf-1',
  status: 'draft',
  leafName: 'マンゴーひとくちゼリー',
  productCode: null,
  pjNo: null,
  itemCount: 1,
  leafQty: 96,
  wholesalePrice: 34950,
  unitPrice: 364,
  isHalfOk: true,
  leadTime: '受注後約1週間',
  shelfLifeDays: 180,
  pieceSize: 'W160×D160×H55mm',
  note: null,
  productImages: ['https://example.com/mango.jpg'],
  flagMessages: [],
};

const template = `
  <div>{{MAIN_COPY}}</div>
  <div>{{SALES_COPY}}</div>
  <div>{{PRODUCT_AREA_CLASS}}</div>
  <div>{{PRODUCT_IMAGES_HTML}}</div>
  <div>{{PRODUCT_CODE}}</div>
  <div>{{LEAF_NAME}}</div>
  <div>{{ITEM_COUNT}}</div>
  <div>{{LEAF_QTY}}</div>
  <div>{{WHOLESALE_PRICE}}</div>
  <div>{{UNIT_PRICE}}</div>
  <div>{{PIECE_SIZE}}</div>
  <div>{{SHELF_LIFE_DAYS}}</div>
  <div>{{LEAD_TIME}}</div>
  <div>{{HALF_LABEL}}</div>
  <div>{{PJ_NO}}</div>
  <div>{{THEME_CLASS}}</div>
  <div>{{THEME_LABEL}}</div>
  <div>{{DRAFT_CLASS}}</div>
  <div>{{STATUS_LABEL}}</div>
  <div>{{HALF_NG_CLASS}}</div>
`;

describe('buildLeafImageHtml', () => {
  it('仮リーフ画像に必要な掲載情報を埋め込める', () => {
    const html = buildLeafImageHtml(baseData, template);

    expect(html).toContain('マンゴーひとくちゼリー');
    expect(html).toContain('商品コード未設定');
    expect(html).toContain('未設定');
    expect(html).toContain('96');
    expect(html).toContain('34,950');
    expect(html).toContain('364');
    expect(html).toContain('160×160×55mm');
    expect(html).toContain('180');
    expect(html).toContain('受注後約1週間');
    expect(html).toContain('可');
    expect(html).toContain('theme-fruit');
    expect(html).toContain('フルーツ');
    expect(html).not.toContain('{{');
  });

  it('アソート画像は複数画像のグリッドを生成する', () => {
    const html = buildLeafImageHtml({
      ...baseData,
      itemCount: 3,
      productImages: [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ],
    }, template);

    expect(html).toContain('assort-3');
    expect(html).toContain('https://example.com/a.jpg');
    expect(html).toContain('https://example.com/b.jpg');
    expect(html).toContain('https://example.com/c.jpg');
  });

  it('HTMLをエスケープして文字化けやレイアウト破壊を防ぐ', () => {
    const html = buildLeafImageHtml({
      ...baseData,
      leafName: '<script>alert(1)</script>',
      note: 'A&B < C',
    }, template);

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A&amp;B &lt; C');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('商品名に合わせてリーフ画像テーマを選択する', () => {
    expect(selectLeafTheme({ ...baseData, leafName: '水羊羹詰め合わせ' }).className).toBe('theme-wagashi');
    expect(selectLeafTheme({ ...baseData, leafName: 'ポップコーンしお味' }).className).toBe('theme-snack');
    expect(selectLeafTheme({ ...baseData, leafName: 'チョコクッキー' }).className).toBe('theme-sweets');
    expect(selectLeafTheme({ ...baseData, leafName: 'ヨーグルトゼリー' }).className).toBe('theme-cool');
  });
});
