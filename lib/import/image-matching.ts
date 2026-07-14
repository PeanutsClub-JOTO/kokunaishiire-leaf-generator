import type { ExtractedImage } from './xlsx-images';

export type ProductImageTarget = {
  id: string;
  sheetName: string | null;
  no: number | null;
  janCode?: string | null;
  productCode?: string | null;
  sourceRow?: number | null;
  sourceCol?: number | null;
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
  maxTextBlockRowDistance?: number;
  maxPositionRowDistance?: number;
  maxPositionColDistance?: number;
  maxInlineRowsBeforeFirstProduct?: number;
  preferSequentialFallback?: boolean;
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
  preferSequentialFallback: boolean,
): ProductImageMatch | null {
  const ordered = [...products].sort(bySourceIndex);
  if (preferSequentialFallback) {
    const product = ordered[0];
    return product ? { productId: product.id, reason: 'sheet_order' } : null;
  }
  if (image.no === null || image.no < 1) return null;
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

function matchByNearestPosition(
  image: ExtractedImage,
  products: ProductImageTarget[],
  maxRowDistance: number,
  maxColDistance: number,
): ProductImageMatch | null {
  const withPosition = products
    .filter(
      (p) =>
        p.sourceRow !== null &&
        p.sourceRow !== undefined &&
        p.sourceCol !== null &&
        p.sourceCol !== undefined,
    )
    .map((p) => {
      const rowDistance = Math.abs((p.sourceRow as number) - image.anchorRow);
      const colDistance = Math.abs((p.sourceCol as number) - image.anchorCol);
      return {
        product: p,
        rowDistance,
        colDistance,
        // 横並びカタログでは列の近さが決定打になる。行は商品ブロック内なら多少離れても許容する。
        score: colDistance * 2 + rowDistance,
      };
    })
    .filter((x) => x.rowDistance <= maxRowDistance && x.colDistance <= maxColDistance)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.colDistance - b.colDistance ||
        a.rowDistance - b.rowDistance ||
        a.product.sourceIndex - b.product.sourceIndex,
    );

  const best = withPosition[0];
  if (!best) return null;
  return {
    productId: best.product.id,
    reason: 'nearest_row',
    rowDistance: best.rowDistance,
  };
}

function isHorizontalCatalog(products: ProductImageTarget[]): boolean {
  const colsByRow = new Map<number, Set<number>>();
  for (const product of products) {
    if (
      product.sourceRow === null ||
      product.sourceRow === undefined ||
      product.sourceCol === null ||
      product.sourceCol === undefined
    ) {
      continue;
    }
    const cols = colsByRow.get(product.sourceRow) ?? new Set<number>();
    cols.add(product.sourceCol);
    colsByRow.set(product.sourceRow, cols);
  }
  return [...colsByRow.values()].some((cols) => cols.size >= 2);
}

function matchByTextBlockBelow(
  image: ExtractedImage,
  products: ProductImageTarget[],
  maxRowDistance: number,
  maxColDistance: number,
): ProductImageMatch | null {
  const candidates = products
    .filter(
      (p) =>
        p.sourceRow !== null &&
        p.sourceRow !== undefined &&
        p.sourceCol !== null &&
        p.sourceCol !== undefined,
    )
    .map((p) => {
      const rowDistance = (p.sourceRow as number) - image.anchorRow;
      const colDistance = Math.abs((p.sourceCol as number) - image.anchorCol);
      return { product: p, rowDistance, colDistance };
    })
    .filter(
      (x) =>
        x.rowDistance >= 0 &&
        x.rowDistance <= maxRowDistance &&
        x.colDistance <= maxColDistance,
    )
    .sort(
      (a, b) =>
        a.colDistance - b.colDistance ||
        a.rowDistance - b.rowDistance ||
        a.product.sourceIndex - b.product.sourceIndex,
    );

  const best = candidates[0];
  if (!best) return null;
  return {
    productId: best.product.id,
    reason: 'nearest_row',
    rowDistance: best.rowDistance,
  };
}

/**
 * Excel埋め込み画像を商品へ対応付ける。
 *
 * 優先順:
 * - 従来の標準テンプレ: シート名 + 商品No
 * - 横並びカタログ: 画像の下にあるJAN/商品名セル
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
  const textBlockRowMax = options.maxTextBlockRowDistance ?? 12;
  const positionRowMax = options.maxPositionRowDistance ?? 10;
  const positionColMax = options.maxPositionColDistance ?? 8;
  const preferSequentialFallback =
    Boolean(options.preferSequentialFallback) && sheetCandidates.every((p) => p.no === null);
  const hasPositionedCandidates = sheetCandidates.some(
    (p) => p.sourceRow !== null && p.sourceRow !== undefined && p.sourceCol !== null && p.sourceCol !== undefined,
  );
  const horizontalCatalog = hasPositionedCandidates && isHorizontalCatalog(sheetCandidates);

  if (horizontalCatalog) {
    const textBlockMatch = matchByTextBlockBelow(
      image,
      sheetCandidates,
      textBlockRowMax,
      positionColMax,
    );
    if (textBlockMatch && options.excludeProductIds?.has(textBlockMatch.productId)) return null;
    return textBlockMatch;
  }

  const byPosition = matchByNearestPosition(
    image,
    sheetCandidates,
    positionRowMax,
    positionColMax,
  );
  if (byPosition && options.excludeProductIds?.has(byPosition.productId)) return null;
  if (byPosition) return byPosition;
  // 商品セルの行・列が取れている資料では、位置で合わない画像を順番だけで補完しない。
  // 横並びカタログではこれが隣接/別段の商品への誤紐付けになりやすい。
  if (hasPositionedCandidates) return null;

  if (image.mappingStrategy === 'inline_anchor') {
    const sourceRows = candidates
      .map((p) => p.sourceRow)
      .filter((r): r is number => r !== null && r !== undefined);
    const minSourceRow = sourceRows.length > 0 ? Math.min(...sourceRows) : null;
    const maxSourceRow = sourceRows.length > 0 ? Math.max(...sourceRows) : null;
    const rowsBeforeFirst = options.maxInlineRowsBeforeFirstProduct ?? 1;
    const canUseNearestRow =
      minSourceRow === null || image.anchorRow >= minSourceRow - rowsBeforeFirst;
    const shouldPreferOrder =
      preferSequentialFallback && maxSourceRow !== null && image.anchorRow > maxSourceRow;

    if (shouldPreferOrder) {
      return (
        matchBySheetOrder(image, candidates, true) ??
        (canUseNearestRow ? matchByNearestRow(image, candidates, inlineMax) : null)
      );
    }

    return (
      (canUseNearestRow ? matchByNearestRow(image, candidates, inlineMax) : null) ??
      matchBySheetOrder(image, candidates, preferSequentialFallback)
    );
  }

  return (
    matchBySheetOrder(image, candidates, preferSequentialFallback) ??
    matchByNearestRow(image, candidates, gridMax)
  );
}
