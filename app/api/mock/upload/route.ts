import { NextRequest, NextResponse } from 'next/server';
import { extractXlsxCells } from '@/lib/import/xlsx-cells';
import { extractXlsxImages } from '@/lib/import/xlsx-images';
import { calcMockSingle, type MockProduct, type MockUploadResponse } from '@/lib/mock/workbench';

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

  // 画像マップ: "sheetName:no" → base64 data URL（プレビュー用）
  const imageByKey = new Map<string, string>();
  for (const img of images) {
    const key = `${img.sheetName ?? ''}:${img.no}`;
    const b64 = img.buffer.toString('base64');
    imageByKey.set(key, `data:${img.mimeType};base64,${b64}`);
  }

  const products: MockProduct[] = [];
  for (const sheet of sheets) {
    for (const p of sheet.products) {
      if (!p.product_name) continue;
      const imgKey = `${sheet.sheet_name}:${p.no}`;
      const imageUrl = p.no != null ? (imageByKey.get(imgKey) ?? null) : null;
      const cost = p.cost ?? 0;
      const irisu = p.case_qty ?? 1;
      const minLot = p.min_lot_qty ?? 1;
      const calc = calcMockSingle(cost, minLot);

      products.push({
        id: `${sheet.sheet_name}:${p.no ?? products.length}`,
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
