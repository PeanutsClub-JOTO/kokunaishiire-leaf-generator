import { NextRequest, NextResponse } from 'next/server';
import { extractXlsxCells } from '@/lib/import/xlsx-cells';
import { extractXlsxImages } from '@/lib/import/xlsx-images';
import { matchImageToProduct, type ProductImageTarget } from '@/lib/import/image-matching';
import { calcMockSingle, type MockProduct, type MockUploadResponse } from '@/lib/mock/workbench';

function mockProductId(sheetName: string, no: number | null, sourceIndex: number): string {
  return `${sheetName}:${no ?? 'row'}:${sourceIndex}`;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const fileName = file.name;

  const [sheets, { images }] = await Promise.all([
    Promise.resolve(extractXlsxCells(buf)),
    extractXlsxImages(buf, { includeInlineAnchors: true }),
  ]);

  // 画像マップ: productId → base64 data URL（プレビュー用）
  const imageByProductId = new Map<string, string>();
  const productTargets: ProductImageTarget[] = [];
  const usedProductIds = new Set<string>();
  const usedGridSlots = new Set<string>();

  for (const sheet of sheets) {
    sheet.products.forEach((p, sourceIndex) => {
      if (!p.product_name) return;
      const id = mockProductId(sheet.sheet_name, p.no, sourceIndex);
      productTargets.push({
        id,
        sheetName: sheet.sheet_name,
        no: p.no,
        sourceRow: p.source_row ?? null,
        sourceIndex,
      });
    });
  }

  for (const img of images) {
    const gridSlot =
      img.mappingStrategy === 'number_grid' && img.no !== null
        ? `${img.sheetName ?? ''}|${img.no}`
        : null;
    if (gridSlot && usedGridSlots.has(gridSlot)) continue;

    const match = matchImageToProduct(img, productTargets, {
      excludeProductIds: usedProductIds,
      preferSequentialFallback: true,
    });
    if (!match) continue;
    usedProductIds.add(match.productId);
    if (gridSlot) usedGridSlots.add(gridSlot);
    const b64 = img.buffer.toString('base64');
    imageByProductId.set(match.productId, `data:${img.mimeType};base64,${b64}`);
  }

  const products: MockProduct[] = [];
  for (const sheet of sheets) {
    for (let sourceIndex = 0; sourceIndex < sheet.products.length; sourceIndex++) {
      const p = sheet.products[sourceIndex];
      if (!p.product_name) continue;
      const id = mockProductId(sheet.sheet_name, p.no, sourceIndex);
      const imageUrl = imageByProductId.get(id) ?? null;
      const cost = p.cost ?? 0;
      const irisu = p.case_qty ?? 1;
      const minLot = p.min_lot_qty ?? 1;
      const calc = calcMockSingle(cost, minLot);

      products.push({
        id,
        no: p.no,
        sheetName: sheet.sheet_name,
        leafName: p.product_name,
        productCode: p.jan_code ?? null,
        cost,
        irisu,
        minLot,
        ...calc,
        shelfLifeDays: p.shelf_life_days ?? 0,
        pieceSize: p.piece_size ?? null,
        leadTime: '受注後約1週間',
        note: p.note ?? null,
        imageUrl,
      });
    }
  }

  const body: MockUploadResponse = { fileName, products };
  return NextResponse.json(body);
}
