import { describe, expect, it } from 'vitest';
import type { ExtractedImage } from './xlsx-images';
import type { ProductImageTarget } from './image-matching';
import { analyzeImageMatchSuspicion } from './image-match-suspicion';

function image(partial: Partial<ExtractedImage>): ExtractedImage {
  return {
    no: null,
    sheetName: 'Sheet1',
    mediaPath: 'xl/media/image1.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(0),
    anchorRow: 10,
    anchorCol: 1,
    mappingStrategy: 'inline_anchor',
    ...partial,
  };
}

const products: ProductImageTarget[] = [
  { id: 'p1', sheetName: 'Sheet1', no: null, janCode: '4900000000001', sourceRow: 4, sourceIndex: 0 },
  { id: 'p2', sheetName: 'Sheet1', no: null, janCode: '4900000000002', sourceRow: 5, sourceIndex: 1 },
];

describe('analyzeImageMatchSuspicion', () => {
  it('flags stacked images matched only by sheet order', () => {
    const result = analyzeImageMatchSuspicion(
      [
        {
          image: image({ mediaPath: 'xl/media/image1.png', anchorRow: 10, anchorCol: 3 }),
          match: { productId: 'p1', reason: 'sheet_order' },
        },
        {
          image: image({ mediaPath: 'xl/media/image2.png', anchorRow: 10, anchorCol: 3 }),
          match: { productId: 'p2', reason: 'sheet_order' },
        },
      ],
      products,
    );

    expect(result.suspicious).toBe(true);
    expect(result.reasons).toContain('overlapping_images');
    expect(result.reasons).toContain('weak_sheet_order_match');
  });

  it('flags far nearest-row matches', () => {
    const result = analyzeImageMatchSuspicion(
      [
        {
          image: image({ mediaPath: 'xl/media/image1.png', anchorRow: 12, anchorCol: 1 }),
          match: { productId: 'p1', reason: 'nearest_row', rowDistance: 4 },
        },
        {
          image: image({ mediaPath: 'xl/media/image2.png', anchorRow: 13, anchorCol: 2 }),
          match: { productId: 'p2', reason: 'nearest_row', rowDistance: 8 },
        },
      ],
      products,
    );

    expect(result.suspicious).toBe(true);
    expect(result.reasons).toContain('image_far_from_product_row');
  });

  it('does not flag count mismatches for AI rematch', () => {
    const result = analyzeImageMatchSuspicion(
      [
        {
          image: image({ mediaPath: 'xl/media/image1.png' }),
          match: { productId: 'p1', reason: 'sheet_order' },
        },
      ],
      products,
    );

    expect(result).toEqual({ suspicious: false, reasons: [] });
  });

  it('does not flag strong number matches', () => {
    const strongProducts: ProductImageTarget[] = [
      { id: 'p1', sheetName: 'Sheet1', no: 1, janCode: '4900000000001', sourceRow: 4, sourceIndex: 0 },
      { id: 'p2', sheetName: 'Sheet1', no: 2, janCode: '4900000000002', sourceRow: 5, sourceIndex: 1 },
    ];
    const result = analyzeImageMatchSuspicion(
      [
        {
          image: image({ no: 1, mediaPath: 'xl/media/image1.png', mappingStrategy: 'number_grid' }),
          match: { productId: 'p1', reason: 'no' },
        },
        {
          image: image({ no: 2, mediaPath: 'xl/media/image2.png', mappingStrategy: 'number_grid', anchorCol: 2 }),
          match: { productId: 'p2', reason: 'no' },
        },
      ],
      strongProducts,
    );

    expect(result).toEqual({ suspicious: false, reasons: [] });
  });
});
