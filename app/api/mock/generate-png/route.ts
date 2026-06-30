import { NextRequest, NextResponse } from 'next/server';
import { generateLeafImageLocal } from '@/lib/leaf/generate-image';
import type { LeafletImageData } from '@/lib/leaf/generate-image';
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
  const { product, overrides, html } = (await req.json()) as MockGeneratePngRequest;

  if (html) {
    try {
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
        const buffer = Buffer.from(await page.screenshot({ type: 'png' }));
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `inline; filename="leaf-${product.id}.png"`,
          },
        });
      } finally {
        await browser.close();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // 商品画像をアップスケール（Puppeteer高解像度出力用）
  let productImages: string[] = [];
  if (product.imageUrl) {
    const parsed = dataUrlToBuffer(product.imageUrl);
    if (parsed) {
      try {
        const { upscaleToDataUrl } = await import('@/lib/leaf/upscale-image');
        const upscaled = await upscaleToDataUrl(parsed.buffer, parsed.mimeType);
        productImages = [upscaled];
      } catch {
        productImages = [product.imageUrl];
      }
    }
  }

  const leafData: LeafletImageData = {
    id: product.id,
    status: overrides.showDraft === false ? 'final' : 'draft',
    leafName: overrides.leafName ?? product.leafName,
    productCode: overrides.productCode ?? product.productCode,
    pjNo: null,
    itemCount: 1,
    leafQty: product.leafQty,
    wholesalePrice: product.wholesalePrice,
    unitPrice: product.unitPrice,
    isHalfOk: false,
    leadTime: overrides.leadTime ?? product.leadTime,
    shelfLifeDays: product.shelfLifeDays,
    pieceSize: product.pieceSize,
    note: overrides.note ?? product.note,
    productImages,
    flagMessages: product.isEligible ? [] : ['1ロット原価が上限超過'],
    catchphrase: overrides.mainCopy ? { main_copy: overrides.mainCopy, sub_copy: '' } : null,
  };

  try {
    const result = await generateLeafImageLocal(leafData);
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="leaf-${product.id}.png"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
