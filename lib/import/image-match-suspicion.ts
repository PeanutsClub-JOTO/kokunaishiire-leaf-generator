import type { ExtractedImage } from './xlsx-images';
import type { ProductImageMatch, ProductImageTarget } from './image-matching';

export type ImageMatchRecord = {
  image: ExtractedImage;
  match: ProductImageMatch;
};

export type ImageMatchSuspicion = {
  suspicious: boolean;
  reasons: string[];
};

function imageAnchorKey(image: ExtractedImage): string {
  return [
    image.sheetName ?? '',
    image.mappingStrategy,
    image.anchorRow,
    image.anchorCol,
  ].join('|');
}

function sheetKey(sheetName: string | null): string {
  return sheetName ?? '';
}

function hasOverlappingImages(image: ExtractedImage, images: ExtractedImage[]): boolean {
  const key = imageAnchorKey(image);
  return images.filter((img) => imageAnchorKey(img) === key).length >= 2;
}

export function analyzeImageMatchSuspicion(
  records: ImageMatchRecord[],
  products: ProductImageTarget[],
  options: { maxRowDistance?: number } = {},
): ImageMatchSuspicion {
  const maxRowDistance = options.maxRowDistance ?? 3;
  const reasons = new Set<string>();

  const imagesBySheet = new Map<string, ExtractedImage[]>();
  const productsBySheet = new Map<string, ProductImageTarget[]>();

  for (const record of records) {
    const key = sheetKey(record.image.sheetName);
    const arr = imagesBySheet.get(key) ?? [];
    arr.push(record.image);
    imagesBySheet.set(key, arr);
  }

  for (const product of products) {
    const key = sheetKey(product.sheetName);
    const arr = productsBySheet.get(key) ?? [];
    arr.push(product);
    productsBySheet.set(key, arr);
  }

  const productById = new Map(products.map((product) => [product.id, product]));

  for (const record of records) {
    const sheetImages = imagesBySheet.get(sheetKey(record.image.sheetName)) ?? [];
    const sheetProducts = productsBySheet.get(sheetKey(record.image.sheetName)) ?? [];

    // 画像と商品の数が合わない場合はロゴ混入・不足の可能性もあるので、
    // ここではAI再判定ではなく従来の未紐付け監視に任せる。
    if (sheetImages.length !== sheetProducts.length || sheetImages.length < 2) continue;

    const product = productById.get(record.match.productId);
    if (!product) continue;

    if (hasOverlappingImages(record.image, sheetImages)) {
      reasons.add('overlapping_images');
    }

    if (
      record.match.reason === 'nearest_row' &&
      typeof record.match.rowDistance === 'number' &&
      record.match.rowDistance > maxRowDistance
    ) {
      reasons.add('image_far_from_product_row');
    }

    if (record.match.reason === 'sheet_order') {
      reasons.add('weak_sheet_order_match');
    }

    if (!product.no && !product.janCode) {
      reasons.add('missing_strong_product_anchor');
    }
  }

  return {
    suspicious: reasons.size > 0,
    reasons: [...reasons].sort(),
  };
}
