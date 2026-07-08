import { NextRequest, NextResponse } from 'next/server';
import { generateLeafImageLocal, selectLeafTheme, detectCategory, flavorOf } from '@/lib/leaf/generate-image';
import type { LeafletImageData } from '@/lib/leaf/generate-image';
import { generateBackground } from '@/lib/leaf/ai-background';
import type { MockGeneratePngRequest } from '@/lib/mock/workbench';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** base64 data URL → Buffer */
function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

export async function POST(req: NextRequest) {
  const { product, overrides, html, assortItems } = (await req.json()) as MockGeneratePngRequest;

  void html; // html パスは廃止。常にフル AI パイプラインを使用

  // アソート情報
  const items = assortItems && assortItems.length > 0 ? assortItems : [product];
  const leafName = overrides.leafName ?? product.leafName;
  const productNames = items.map((p) => p.leafName);

  // 商品画像をアップスケール
  async function resolveProductImages(sources: (string | null)[]): Promise<string[]> {
    const result: string[] = [];
    for (const src of sources) {
      if (!src) continue;
      const parsed = dataUrlToBuffer(src);
      if (parsed) {
        try {
          const { upscaleToDataUrl } = await import('@/lib/leaf/upscale-image');
          result.push(await upscaleToDataUrl(parsed.buffer, parsed.mimeType));
        } catch {
          result.push(src);
        }
      } else {
        result.push(src);
      }
    }
    return result;
  }

  const productImages = await resolveProductImages(items.map((p) => p.imageUrl));

  // AI 背景生成（失敗時は null → CSS フォールバック）
  const theme = selectLeafTheme({ leafName, productImages } as Parameters<typeof selectLeafTheme>[0]);
  const category = detectCategory(leafName);
  const flavor = flavorOf(leafName);

  const bgBuffer = await generateBackground({
    leafName,
    category,
    flavor,
    themeLabel: theme.label,
    itemCount: items.length,
    productNames,
    productImages,
  });

  const aiBgDataUrl = bgBuffer
    ? `data:image/png;base64,${bgBuffer.toString('base64')}`
    : null;

  const leafData: LeafletImageData = {
    id: product.id,
    status: overrides.showDraft === false ? 'final' : 'draft',
    leafName,
    productCode: overrides.productCode ?? product.productCode,
    pjNo: null,
    itemCount: items.length,
    leafQty: product.leafQty,
    wholesalePrice: product.wholesalePrice,
    unitPrice: product.unitPrice,
    isHalfOk: false,
    leadTime: overrides.leadTime ?? product.leadTime,
    shelfLifeDays: product.shelfLifeDays,
    pieceSize: product.pieceSize,
    note: overrides.note ?? product.note,
    productNames,
    productImages,
    flagMessages: product.isEligible ? [] : ['1ロット原価が上限超過'],
    catchphrase: overrides.mainCopy ? { main_copy: overrides.mainCopy, sub_copy: '' } : null,
    aiBgDataUrl,
  };

  try {
    const result = await generateLeafImageLocal(leafData);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="leaf-${encodeURIComponent(product.id)}.png"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
