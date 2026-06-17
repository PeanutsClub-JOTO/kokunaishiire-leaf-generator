/**
 * 商品画像をLanczos3補間でアップスケール
 *
 * Excelから抽出した画像は200〜400px程度のことが多い。
 * リーフのヒーローエリア（2x: 1760×1200px相当）に引き伸ばすと
 * ブラウザのbicubicより大幅に鮮明になる。
 */
import sharp from 'sharp';

const TARGET_LONGER_SIDE = 1600; // 長辺の目標px（2x出力で3200px相当）

export async function upscaleImageBuffer(buffer: Buffer): Promise<Buffer> {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const longer = Math.max(w, h);

  if (longer >= TARGET_LONGER_SIDE) {
    // 既に十分な解像度 → そのまま返す
    return buffer;
  }

  const scale = TARGET_LONGER_SIDE / longer;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);

  return img
    .resize(newW, newH, {
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false,
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/** Base64データURLに変換（アップスケール済み） */
export async function upscaleToDataUrl(
  buffer: Buffer,
  mimeType = 'image/png',
): Promise<string> {
  const upscaled = await upscaleImageBuffer(buffer);
  return `data:${mimeType};base64,${upscaled.toString('base64')}`;
}

/** URL から画像を取得してアップスケールしたデータURLを返す */
export async function fetchAndUpscale(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return upscaleToDataUrl(buf);
  } catch {
    return null;
  }
}
