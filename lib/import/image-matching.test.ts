import { describe, expect, it } from 'vitest';
import type { ExtractedImage } from './xlsx-images';
import { matchImageToProduct, type ProductImageTarget } from './image-matching';

function img(partial: Partial<ExtractedImage>): ExtractedImage {
  return {
    no: null,
    sheetName: 'Sheet1',
    mediaPath: 'xl/media/image1.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(0),
    anchorRow: 0,
    anchorCol: 0,
    mappingStrategy: 'inline_anchor',
    ...partial,
  };
}

const products: ProductImageTarget[] = [
  { id: 'p1', sheetName: 'Sheet1', no: 1, sourceRow: 10, sourceIndex: 0 },
  { id: 'p2', sheetName: 'Sheet1', no: 2, sourceRow: 11, sourceIndex: 1 },
  { id: 'p3', sheetName: 'Sheet1', no: null, sourceRow: 12, sourceIndex: 2 },
];

describe('matchImageToProduct', () => {
  it('matches standard image grids by product number first', () => {
    const match = matchImageToProduct(
      img({ no: 2, mappingStrategy: 'number_grid', anchorRow: 24 }),
      products,
    );

    expect(match).toEqual({ productId: 'p2', reason: 'no' });
  });

  it('falls back to sheet order when products have no number', () => {
    const match = matchImageToProduct(
      img({ no: 2, mappingStrategy: 'number_grid', anchorRow: 24 }),
      products.map((p) => ({ ...p, no: null })),
    );

    expect(match).toEqual({ productId: 'p2', reason: 'sheet_order' });
  });

  it('can assign no-less products sequentially when image grid numbers are unreliable', () => {
    const noLessProducts = products.map((p) => ({ ...p, no: null }));
    const used = new Set<string>(['p1', 'p2']);
    const match = matchImageToProduct(
      img({ no: 11, mappingStrategy: 'number_grid', anchorRow: 25 }),
      noLessProducts,
      { excludeProductIds: used, preferSequentialFallback: true },
    );

    expect(match).toEqual({ productId: 'p3', reason: 'sheet_order' });
  });

  it('matches inline images to the nearest source row', () => {
    const match = matchImageToProduct(
      img({ anchorRow: 12, mappingStrategy: 'inline_anchor' }),
      products,
    );

    expect(match).toEqual({ productId: 'p3', reason: 'nearest_row', rowDistance: 0 });
  });

  it('does not map likely header images far above the first product row', () => {
    const match = matchImageToProduct(
      img({ anchorRow: 7, mappingStrategy: 'inline_anchor' }),
      products,
    );

    expect(match).toBeNull();
  });

  it('does not shift duplicate numbered images to the next product', () => {
    const match = matchImageToProduct(
      img({ no: 1, mappingStrategy: 'number_grid', anchorRow: 24 }),
      products,
      { excludeProductIds: new Set(['p1']) },
    );

    expect(match).toBeNull();
  });
});
