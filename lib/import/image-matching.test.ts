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

  it('assigns stacked inline images below no-less product rows by sheet order', () => {
    const noLessProducts = products.slice(0, 2).map((p) => ({ ...p, no: null }));
    const first = matchImageToProduct(
      img({ anchorRow: 17, anchorCol: 3, mappingStrategy: 'inline_anchor' }),
      noLessProducts,
      { preferSequentialFallback: true },
    );
    const second = matchImageToProduct(
      img({ anchorRow: 17, anchorCol: 3, mappingStrategy: 'inline_anchor' }),
      noLessProducts,
      { excludeProductIds: new Set(['p1']), preferSequentialFallback: true },
    );

    expect(first).toEqual({ productId: 'p1', reason: 'sheet_order' });
    expect(second).toEqual({ productId: 'p2', reason: 'sheet_order' });
  });

  it('still matches inline images beside product rows by nearest row', () => {
    const noLessProducts = products.slice(0, 2).map((p) => ({ ...p, no: null }));
    const match = matchImageToProduct(
      img({ anchorRow: 11, anchorCol: 8, mappingStrategy: 'inline_anchor' }),
      noLessProducts,
      { preferSequentialFallback: true },
    );

    expect(match).toEqual({ productId: 'p2', reason: 'nearest_row', rowDistance: 0 });
  });

  it('matches horizontal catalog images to the JAN/name block below the image', () => {
    const horizontalProducts: ProductImageTarget[] = [
      { id: 'p1', sheetName: 'Sheet1', no: null, sourceRow: 12, sourceCol: 2, sourceIndex: 0 },
      { id: 'p2', sheetName: 'Sheet1', no: null, sourceRow: 12, sourceCol: 12, sourceIndex: 1 },
      { id: 'p3', sheetName: 'Sheet1', no: null, sourceRow: 12, sourceCol: 22, sourceIndex: 2 },
      { id: 'p4', sheetName: 'Sheet1', no: null, sourceRow: 12, sourceCol: 32, sourceIndex: 3 },
    ];

    const match = matchImageToProduct(
      img({ anchorRow: 5, anchorCol: 23, mappingStrategy: 'inline_anchor' }),
      horizontalProducts,
      { preferSequentialFallback: true },
    );

    expect(match).toEqual({ productId: 'p3', reason: 'nearest_row', rowDistance: 7 });
  });

  it('prefers the lower JAN/name block over a closer previous row in horizontal catalogs', () => {
    const horizontalProducts: ProductImageTarget[] = [
      { id: 'top1', sheetName: 'Sheet1', no: null, sourceRow: 11, sourceCol: 10, sourceIndex: 0 },
      { id: 'top2', sheetName: 'Sheet1', no: null, sourceRow: 11, sourceCol: 18, sourceIndex: 1 },
      { id: 'next1', sheetName: 'Sheet1', no: null, sourceRow: 20, sourceCol: 10, sourceIndex: 2 },
      { id: 'next2', sheetName: 'Sheet1', no: null, sourceRow: 20, sourceCol: 18, sourceIndex: 3 },
    ];

    const match = matchImageToProduct(
      img({ anchorRow: 14, anchorCol: 11, mappingStrategy: 'inline_anchor' }),
      horizontalProducts,
      { preferSequentialFallback: true },
    );

    expect(match).toEqual({ productId: 'next1', reason: 'nearest_row', rowDistance: 6 });
  });

  it('does not fall back to sheet order when positioned catalog images are too far away', () => {
    const horizontalProducts: ProductImageTarget[] = [
      { id: 'p1', sheetName: 'Sheet1', no: null, sourceRow: 11, sourceCol: 2, sourceIndex: 0 },
      { id: 'p2', sheetName: 'Sheet1', no: null, sourceRow: 20, sourceCol: 2, sourceIndex: 1 },
      { id: 'p3', sheetName: 'Sheet1', no: null, sourceRow: 47, sourceCol: 42, sourceIndex: 2 },
    ];

    const match = matchImageToProduct(
      img({ anchorRow: 15, anchorCol: 3, mappingStrategy: 'inline_anchor' }),
      horizontalProducts,
      {
        excludeProductIds: new Set(['p1', 'p2']),
        preferSequentialFallback: true,
      },
    );

    expect(match).toBeNull();
  });

  it('does not move a positioned duplicate image to the next available product', () => {
    const horizontalProducts: ProductImageTarget[] = [
      { id: 'p1', sheetName: 'Sheet1', no: null, sourceRow: 20, sourceCol: 26, sourceIndex: 0 },
      { id: 'p2', sheetName: 'Sheet1', no: null, sourceRow: 20, sourceCol: 34, sourceIndex: 1 },
    ];

    const match = matchImageToProduct(
      img({ anchorRow: 14, anchorCol: 28, mappingStrategy: 'inline_anchor' }),
      horizontalProducts,
      {
        excludeProductIds: new Set(['p1']),
        preferSequentialFallback: true,
      },
    );

    expect(match).toBeNull();
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
