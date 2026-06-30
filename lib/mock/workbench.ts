export type MockProduct = {
  id: string;
  no: number | null;
  sheetName: string;
  leafName: string;
  productCode: string | null;
  cost: number;
  irisu: number;
  minLot: number;
  lotSize: number;
  lotCost: number;
  leafQty: number;
  costTotal: number;
  wholesalePrice: number;
  unitPrice: number;
  isEligible: boolean;
  shelfLifeDays: number;
  pieceSize: string | null;
  leadTime: string;
  note: string | null;
  imageUrl: string | null;
};

export type MockUploadResponse = {
  fileName: string;
  products: MockProduct[];
};

export type MockImageOverrides = {
  leafName?: string;
  leadTime?: string;
  note?: string;
  mainCopy?: string;
  productCode?: string;
  showDraft?: boolean;
};

export type MockGeneratePngRequest = {
  product: MockProduct;
  overrides: MockImageOverrides;
  html?: string;
};

export function calcMockSingle(cost: number, minLotQty: number): Pick<
  MockProduct,
  'lotSize' | 'lotCost' | 'leafQty' | 'costTotal' | 'wholesalePrice' | 'unitPrice' | 'isEligible'
> {
  const lotSize = Math.max(minLotQty, 0);
  const lotCost = lotSize * cost;

  if (lotCost > 33000 || lotCost === 0) {
    const wholesalePrice = lotCost > 0 ? (lotCost + 3000) * 1.25 : 0;
    const unitPrice = lotSize > 0 ? wholesalePrice / lotSize : 0;
    return { lotSize, lotCost, leafQty: lotSize, costTotal: lotCost, wholesalePrice, unitPrice, isEligible: false };
  }

  const maxLots = Math.floor(33000 / lotCost);
  const leafQty = maxLots * lotSize;
  const costTotal = maxLots * lotCost;
  const wholesalePrice = (costTotal + 3000) * 1.25;
  const unitPrice = leafQty > 0 ? wholesalePrice / leafQty : 0;

  return { lotSize, lotCost, leafQty, costTotal, wholesalePrice, unitPrice, isEligible: unitPrice <= 1000 };
}

export function canMockAssort(base: MockProduct | null, candidate: MockProduct): boolean {
  return Boolean(
    base &&
    candidate.id !== base.id &&
    base.isEligible &&
    candidate.isEligible &&
    candidate.cost === base.cost,
  );
}
