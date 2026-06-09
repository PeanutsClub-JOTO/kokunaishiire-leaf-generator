import { describe, it, expect } from 'vitest';
import { escapeHtml, buildHtml, type LeafletData } from './generate-pdf';

describe('escapeHtml', () => {
  it('HTML特殊文字をエスケープする', () => {
    expect(escapeHtml('<script>alert("test & test")</script>'))
      .toBe('&lt;script&gt;alert(&quot;test &amp; test&quot;)&lt;/script&gt;');
  });

  it('nullやundefinedは空文字を返す', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('buildHtml', () => {
  it('テンプレートに正しくデータを埋め込める', () => {
    const data: LeafletData = {
      id: '123',
      status: 'draft',
      leafName: 'テスト商品',
      productCode: 'A123',
      pjNo: '9999',
      itemCount: 1,
      leafQty: 12,
      costTotal: 4800,
      wholesalePrice: 9750,
      unitPrice: 812.5,
      isHalfOk: true,
      leadTime: '受注後約1週間',
      shelfLifeDays: 180,
      pieceSize: 'W100xD100xH100',
      janCode: '4900000000000',
      note: 'テスト備考',
      imageUrl: 'https://example.com/image.jpg',
      flagMessages: ['unit_near_cap'],
    };

    const templateHtml = `
      <div id="leafName">{{LEAF_NAME}}</div>
      <div id="price">{{UNIT_PRICE}}</div>
      <div id="costTotal">{{COST_TOTAL}}</div>
      <div id="status">{{STATUS}}</div>
      <div id="flags">{{FLAGS_TEXT}}</div>
    `;

    const html = buildHtml(data, templateHtml, 'font.ttf');

    expect(html).toContain('<div id="leafName">テスト商品</div>');
    expect(html).toContain('<div id="price">812.5</div>');
    expect(html).toContain('<div id="costTotal">4,800</div>');
    expect(html).toContain('<div id="status">仮リーフ</div>');
    expect(html).toContain('<div id="flags">unit_near_cap</div>');
  });
});
