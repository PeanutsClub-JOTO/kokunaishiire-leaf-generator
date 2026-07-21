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
    extractXlsxImages(buf),
  ]);

  // 画像マップ: productId → base64 data URL（プレビュー用）
  const imageByProductId = new Map<string, string>();
  const productTargets: ProductImageTarget[] = [];
  const usedProductIds = new Set<string>();

  for (const sheet of sheets) {
    sheet.products.forEach((p, sourceIndex) => {
      if (!p.product_name) return;
      const id = mockProductId(sheet.sheet_name, p.no, sourceIndex);
      productTargets.push({
        id,
        sheetName: sheet.sheet_name,
        janCode: p.jan_code,
        productCode: p.product_code,
        productName: p.product_name,
        makerName: p.maker_name,
        specRaw: p.spec_raw,
        retailPrice: p.retail_price,
        cost: p.cost,
      });
    });
  }

  // Pass 1: 決定論マッチのみ（モックUIはLLM無しで即応する）
  const unresolved: typeof images = [];
  for (const img of images) {
    const match = await matchImageToProduct(img, productTargets, {
      excludeProductIds: usedProductIds,
      enableLlmFallback: false,
    });
    if (!match) {
      unresolved.push(img);
      continue;
    }
    usedProductIds.add(match.productId);
    const b64 = img.buffer.toString('base64');
    imageByProductId.set(match.productId, `data:${img.mimeType};base64,${b64}`);
  }

  // Pass 2: LLM画像内容マッチ
  for (const img of unresolved) {
    const match = await matchImageToProduct(img, productTargets, {
      excludeProductIds: usedProductIds,
      enableLlmFallback: true,
    }).catch(() => null);
    if (!match || usedProductIds.has(match.productId)) continue;
    usedProductIds.add(match.productId);
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
