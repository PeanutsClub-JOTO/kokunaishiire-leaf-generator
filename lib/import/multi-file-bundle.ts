import type { ExtractedImage } from './xlsx-images';
import { matchImageToProduct, type ProductImageTarget } from './image-matching';
import { normalizeProductCode, type RawProductRow, type RawSheetData } from './xlsx-cells';

export type WorkbookRole = 'quotation' | 'catalog' | 'order' | 'reference';

export type WorkbookBundleSource = {
  fileName: string;
  sheets: RawSheetData[];
  images: ExtractedImage[];
};

export type MergedProductImage = {
  sheetName: string;
  sourceIndex: number;
  image: ExtractedImage;
};

export type WorkbookBundleMergeResult = {
  sheets: RawSheetData[];
  productImages: MergedProductImage[];
  diagnostics: {
    files: Array<{
      fileName: string;
      role: WorkbookRole;
      productCount: number;
      imageCount: number;
    }>;
  };
};

type SourceProduct = {
  id: string;
  fileName: string;
  role: WorkbookRole;
  sheetName: string;
  sourceRow: RawProductRow;
  image: ExtractedImage | null;
};

type CanonicalProduct = {
  row: RawProductRow;
  sheetName: string;
  role: WorkbookRole;
  image: ExtractedImage | null;
};

function cleanName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[★●■◆◇○]/g, '')
    .replace(/[（(]\s*新\s*[）)]/g, '')
    .replace(/^新/, '')
    .replace(/\s+/g, '')
    .replace(/[・･／/＿_\-—－ー]/g, '')
    .toLowerCase();
}

function productJan(row: RawProductRow): string | null {
  const digits = row.jan_code?.normalize('NFKC').replace(/\D/g, '') ?? '';
  return digits.length >= 8 ? digits : null;
}

function identityKeys(row: RawProductRow): string[] {
  const keys: string[] = [];
  const jan = productJan(row);
  if (jan) keys.push(`jan:${jan}`);

  const productCode = normalizeProductCode(row.product_code);
  if (productCode) {
    keys.push(`code:${productCode}`);
    if (/^\d{8,18}$/.test(productCode)) keys.push(`jan:${productCode}`);
  }

  return [...new Set(keys)];
}

function canUseNameMatch(source: RawProductRow, target: RawProductRow): boolean {
  const sourceKeys = identityKeys(source);
  const targetKeys = identityKeys(target);
  if (sourceKeys.length === 0 || targetKeys.length === 0) return true;
  const targetKeySet = new Set(targetKeys);
  return sourceKeys.some((key) => targetKeySet.has(key));
}

function cloneRow(row: RawProductRow): RawProductRow {
  return {
    ...row,
    parse_errors: [...row.parse_errors],
  };
}

function mergeRow(base: RawProductRow, incoming: RawProductRow): void {
  const fill = <K extends keyof RawProductRow>(key: K) => {
    if (base[key] === null || base[key] === undefined) {
      base[key] = incoming[key] as RawProductRow[K];
    }
  };

  fill('maker_name');
  fill('spec_raw');
  fill('spec_pieces');
  fill('spec_grams');
  fill('irisu_raw');
  fill('case_qty');
  fill('lots_per_kou');
  fill('min_lot_raw');
  fill('min_lot_qty');
  fill('retail_price');
  fill('cost');
  fill('jan_code');
  fill('product_code');
  fill('shelf_life_days');
  fill('sales_period_raw');
  fill('sales_period_start');
  fill('sales_period_end');
  fill('piece_size');
  fill('note');

  const seenErrors = new Set(base.parse_errors);
  for (const err of incoming.parse_errors) {
    if (!seenErrors.has(err)) base.parse_errors.push(err);
  }
}

export function classifyWorkbookRole(fileName: string, sheets: RawSheetData[]): WorkbookRole {
  const normalizedName = fileName.normalize('NFKC');
  const products = sheets.flatMap((sheet) => sheet.products);
  const productCount = products.length;
  const costCount = products.filter((p) => p.cost !== null && p.cost > 0).length;
  const identityCount = products.filter((p) => identityKeys(p).length > 0).length;
  const shelfCount = products.filter((p) => p.shelf_life_days !== null).length;

  if (/発注|注文/.test(normalizedName)) return 'order';
  if (/見積|御見積|お見積/.test(normalizedName)) return 'quotation';
  if (/商品リスト|商品一覧|リスト/.test(normalizedName)) return 'catalog';
  if (costCount > 0) return 'quotation';
  if (productCount > 0 && (identityCount >= Math.ceil(productCount / 2) || shelfCount > 0)) {
    return 'catalog';
  }
  return 'reference';
}

function imageBySourceProduct(
  source: WorkbookBundleSource,
  role: WorkbookRole,
): Map<string, ExtractedImage> {
  const targets: ProductImageTarget[] = [];
  source.sheets.forEach((sheet, sheetIndex) => {
    sheet.products.forEach((product, sourceIndex) => {
      targets.push({
        id: `${sheetIndex}:${sourceIndex}`,
        sheetName: sheet.sheet_name,
        no: product.no,
        janCode: product.jan_code,
        productCode: product.product_code,
        sourceRow: product.source_row ?? null,
        sourceCol: product.source_col ?? null,
        sourceIndex,
      });
    });
  });

  const result = new Map<string, ExtractedImage>();
  const usedProductIds = new Set<string>();
  const usedGridSlots = new Set<string>();

  for (const img of source.images) {
    const gridSlot =
      img.mappingStrategy === 'number_grid' && img.no !== null
        ? `${img.sheetName ?? ''}|${img.no}`
        : null;
    if (gridSlot && usedGridSlots.has(gridSlot)) continue;

    const match = matchImageToProduct(img, targets, {
      excludeProductIds: usedProductIds,
      preferSequentialFallback: true,
    });
    if (!match) continue;

    usedProductIds.add(match.productId);
    if (gridSlot) usedGridSlots.add(gridSlot);
    result.set(match.productId, img);
  }

  void role;
  return result;
}

function sourceProducts(source: WorkbookBundleSource, role: WorkbookRole): SourceProduct[] {
  const images = imageBySourceProduct(source, role);
  return source.sheets.flatMap((sheet, sheetIndex) =>
    sheet.products.map((product, sourceIndex) => ({
      id: `${sheetIndex}:${sourceIndex}`,
      fileName: source.fileName,
      role,
      sheetName: sheet.sheet_name,
      sourceRow: product,
      image: images.get(`${sheetIndex}:${sourceIndex}`) ?? null,
    })),
  );
}

function findCanonicalIndex(
  source: SourceProduct,
  canonical: CanonicalProduct[],
  identityMap: Map<string, number>,
  ambiguousIdentityKeys: Set<string>,
  nameMap: Map<string, number>,
  ambiguousNames: Set<string>,
  allowExactNameMatch: boolean,
  allowFuzzyNameMatch: boolean,
): number | null {
  for (const key of identityKeys(source.sourceRow)) {
    if (ambiguousIdentityKeys.has(key)) continue;
    const hit = identityMap.get(key);
    if (hit !== undefined) return hit;
  }

  const name = cleanName(source.sourceRow.product_name);
  if (allowExactNameMatch && name && !ambiguousNames.has(name) && nameMap.has(name)) {
    const hit = nameMap.get(name) ?? null;
    if (hit !== null && canUseNameMatch(source.sourceRow, canonical[hit].row)) return hit;
  }

  if (!allowFuzzyNameMatch) return null;
  if (name && ambiguousNames.has(name)) return null;

  for (let i = 0; i < canonical.length; i++) {
    const existingName = cleanName(canonical[i].row.product_name);
    if (!name || !existingName) continue;
    if (ambiguousNames.has(existingName)) continue;
    if (!canUseNameMatch(source.sourceRow, canonical[i].row)) continue;
    if (name.includes(existingName) || existingName.includes(name)) return i;
  }

  return null;
}

function hasStrongImageIdentity(incoming: RawProductRow, base: RawProductRow): boolean {
  const baseIdentityKeys = new Set(identityKeys(base));
  if (identityKeys(incoming).some((key) => baseIdentityKeys.has(key))) return true;

  const incomingName = cleanName(incoming.product_name);
  const baseName = cleanName(base.product_name);
  return Boolean(incomingName && baseName && incomingName === baseName);
}

function rememberCanonical(
  index: number,
  canonical: CanonicalProduct[],
  identityMap: Map<string, number>,
  ambiguousIdentityKeys: Set<string>,
  nameMap: Map<string, number>,
  ambiguousNames: Set<string>,
): void {
  const row = canonical[index].row;
  const name = cleanName(row.product_name);
  for (const key of identityKeys(row)) {
    const current = identityMap.get(key);
    if (current !== undefined && current !== index) {
      identityMap.delete(key);
      ambiguousIdentityKeys.add(key);
      continue;
    }
    if (!ambiguousIdentityKeys.has(key)) identityMap.set(key, index);
  }
  if (!name) return;
  const current = nameMap.get(name);
  if (current !== undefined && current !== index) {
    nameMap.delete(name);
    ambiguousNames.add(name);
    return;
  }
  if (!ambiguousNames.has(name)) nameMap.set(name, index);
}

function uniqueSheetName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name} (${i})`)) i++;
  const next = `${name} (${i})`;
  used.add(next);
  return next;
}

export function mergeWorkbookBundle(sources: WorkbookBundleSource[]): WorkbookBundleMergeResult {
  const roles = sources.map((source) => ({
    source,
    role: classifyWorkbookRole(source.fileName, source.sheets),
  }));

  const allProducts = roles.flatMap(({ source, role }) => sourceProducts(source, role));
  const hasQuotation = roles.some(({ role }) => role === 'quotation');
  const baseProducts = allProducts.filter((product) =>
    hasQuotation ? product.role === 'quotation' : true,
  );
  const supportProducts = allProducts.filter((product) =>
    hasQuotation ? product.role !== 'quotation' : false,
  );

  const canonical: CanonicalProduct[] = [];
  const identityMap = new Map<string, number>();
  const ambiguousIdentityKeys = new Set<string>();
  const nameMap = new Map<string, number>();
  const ambiguousNames = new Set<string>();

  for (const product of baseProducts) {
    const existing = findCanonicalIndex(
      product,
      canonical,
      identityMap,
      ambiguousIdentityKeys,
      nameMap,
      ambiguousNames,
      false,
      false,
    );
    if (existing !== null) {
      mergeRow(canonical[existing].row, product.sourceRow);
      if (!canonical[existing].image && product.image) canonical[existing].image = product.image;
      rememberCanonical(existing, canonical, identityMap, ambiguousIdentityKeys, nameMap, ambiguousNames);
      continue;
    }

    const index = canonical.length;
    canonical.push({
      row: cloneRow(product.sourceRow),
      sheetName: product.sheetName,
      role: product.role,
      image: product.image,
    });
    rememberCanonical(index, canonical, identityMap, ambiguousIdentityKeys, nameMap, ambiguousNames);
  }

  for (const product of supportProducts) {
    const existing = findCanonicalIndex(
      product,
      canonical,
      identityMap,
      ambiguousIdentityKeys,
      nameMap,
      ambiguousNames,
      true,
      true,
    );
    if (existing === null) continue;
    const canCarryImage =
      Boolean(product.image) && hasStrongImageIdentity(product.sourceRow, canonical[existing].row);
    mergeRow(canonical[existing].row, product.sourceRow);
    if (!canonical[existing].image && product.image && canCarryImage) {
      canonical[existing].image = product.image;
    }
    rememberCanonical(existing, canonical, identityMap, ambiguousIdentityKeys, nameMap, ambiguousNames);
  }

  const sheetGroups = new Map<string, CanonicalProduct[]>();
  for (const product of canonical) {
    const key = product.sheetName || product.role;
    const arr = sheetGroups.get(key) ?? [];
    arr.push(product);
    sheetGroups.set(key, arr);
  }

  const usedSheetNames = new Set<string>();
  const sheets: RawSheetData[] = [];
  const productImages: MergedProductImage[] = [];

  for (const [rawSheetName, products] of sheetGroups) {
    const sheetName = uniqueSheetName(rawSheetName, usedSheetNames);
    const rows = products.map((product) => product.row);
    sheets.push({
      sheet_name: sheetName,
      maker_name: rows.find((row) => row.maker_name)?.maker_name ?? null,
      products: rows,
    });
    products.forEach((product, sourceIndex) => {
      if (!product.image) return;
      productImages.push({ sheetName, sourceIndex, image: product.image });
    });
  }

  return {
    sheets,
    productImages,
    diagnostics: {
      files: roles.map(({ source, role }) => ({
        fileName: source.fileName,
        role,
        productCount: source.sheets.reduce((n, sheet) => n + sheet.products.length, 0),
        imageCount: source.images.length,
      })),
    },
  };
}
