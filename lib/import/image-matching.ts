import type { ExtractedImage } from './xlsx-images';

export type ProductImageTarget = {
  id: string;
  sheetName: string | null;
  no: number | null;
  sourceRow?: number | null;
  sourceIndex: number;
};

export type ProductImageMatch = {
  productId: string;
  reason: 'no' | 'sheet_order' | 'nearest_row';
  rowDistance?: number;
};

type MatchOptions = {
  excludeProductIds?: ReadonlySet<string>;
  maxInlineRowDistance?: number;
  maxGridRowDistance?: number;
  maxInlineRowsBeforeFirstProduct?: number;
};

function sameSheetCandidates(
  image: Pick<ExtractedImage, 'sheetName'>,
  products: ProductImageTarget[],
): ProductImageTarget[] {
  if (!image.sheetName) return products;
  const matched = products.filter((p) => p.sheetName === image.sheetName);
  return matched.length > 0 ? matched : products;
}

function availableProducts(
  products: ProductImageTarget[],
  excludeProductIds?: ReadonlySet<string>,
): ProductImageTarget[] {
  if (!excludeProductIds || excludeProductIds.size === 0) return products;
  return products.filter((p) => !excludeProductIds.has(p.id));
}

function bySourceIndex(a: ProductImageTarget, b: ProductImageTarget): number {
  return a.sourceIndex - b.sourceIndex;
}

function matchByNo(
  image: ExtractedImage,
  products: ProductImageTarget[],
): ProductImageMatch | null {
  if (image.no === null) return null;
  const exact = products.filter((p) => p.no === image.no).sort(bySourceIndex);
  const product = exact[0];
  return product ? { productId: product.id, reason: 'no' } : null;
}

function matchBySheetOrder(
  image: ExtractedImage,
  products: ProductImageTarget[],
): ProductImageMatch | null {
  if (image.no === null || image.no < 1) return null;
  const ordered = [...products].sort(bySourceIndex);
  const product = ordered[image.no - 1];
  return product ? { productId: product.id, reason: 'sheet_order' } : null;
}

function matchByNearestRow(
  image: ExtractedImage,
  products: ProductImageTarget[],
  maxDistance: number,
): ProductImageMatch | null {
  const withRows = products
    .filter((p) => p.sourceRow !== null && p.sourceRow !== undefined)
    .map((p) => ({
      product: p,
      distance: Math.abs((p.sourceRow as number) - image.anchorRow),
    }))
    .sort((a, b) => a.distance - b.distance || a.product.sourceIndex - b.product.sourceIndex);

  const best = withRows[0];
  if (!best || best.distance > maxDistance) return null;
  return {
    productId: best.product.id,
    reason: 'nearest_row',
    rowDistance: best.distance,
  };
}

/**
 * Excel埋め込み画像を商品へ対応付ける。
 *
 * 優先順:
 * - 従来の標準テンプレ: シート名 + 商品No
 * - No列がない標準テンプレ: シート内の商品順
 * - 表の行内/横にある画像: 画像アンカー行に最も近い商品行
 */
export function matchImageToProduct(
  image: ExtractedImage,
  products: ProductImageTarget[],
  options: MatchOptions = {},
): ProductImageMatch | null {
  const sheetCandidates = sameSheetCandidates(image, products);
  const exactNoCandidates =
    image.no === null ? [] : sheetCandidates.filter((p) => p.no === image.no);
  const candidates = availableProducts(sheetCandidates, options.excludeProductIds);
  if (candidates.length === 0) return null;

  const byNo = matchByNo(image, candidates);
  if (byNo) return byNo;
  // 同じNoの商品が既に画像割当済みなら、重複画像として扱い次の商品へずらさない。
  if (exactNoCandidates.length > 0) return null;

  const inlineMax = options.maxInlineRowDistance ?? 4;
  const gridMax = options.maxGridRowDistance ?? 2;

  if (image.mappingStrategy === 'inline_anchor') {
    const sourceRows = candidates
      .map((p) => p.sourceRow)
      .filter((r): r is number => r !== null && r !== undefined);
    const minSourceRow = sourceRows.length > 0 ? Math.min(...sourceRows) : null;
    const rowsBeforeFirst = options.maxInlineRowsBeforeFirstProduct ?? 1;
    const canUseNearestRow =
      minSourceRow === null || image.anchorRow >= minSourceRow - rowsBeforeFirst;

    return (
      (canUseNearestRow ? matchByNearestRow(image, candidates, inlineMax) : null) ??
      matchBySheetOrder(image, candidates)
    );
  }

  return (
    matchBySheetOrder(image, candidates) ??
    matchByNearestRow(image, candidates, gridMax)
  );
}
