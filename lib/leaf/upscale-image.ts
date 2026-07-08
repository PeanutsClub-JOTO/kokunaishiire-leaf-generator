/**
 * 商品画像をLanczos3補間でアップスケール＋白枠トリミング
 *
 * Excelから抽出した画像は200〜400px程度のことが多い。
 * リーフのヒーローエリア（2x: 1760×1200px相当）に引き伸ばすと
 * ブラウザのbicubicより大幅に鮮明になる。
 * 白背景の余白はtrimで除去してから拡大する。
 */
import sharp from 'sharp';

const TARGET_LONGER_SIDE = 1600;

/**
 * 白・薄グレーの余白を除去する。
 * threshold: 240以上のRGBを「白とみなしてトリム」（sharpのtrimはalphaまたは背景色基準）
 */
async function trimWhiteBorder(buffer: Buffer): Promise<Buffer> {
  try {
    // PNGに変換してからtrim（JPEGはtrimが不安定なため）
    const png = await sharp(buffer).png().toBuffer();
    const trimmed = await sharp(png)
      .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 30 })
      .toBuffer();
    // トリム後が元より著しく小さい場合（=余白が多かった）はトリム結果を採用
    const origMeta = await sharp(buffer).metadata();
    const trimMeta = await sharp(trimmed).metadata();
    const origArea = (origMeta.width ?? 0) * (origMeta.height ?? 0);
    const trimArea = (trimMeta.width ?? 0) * (trimMeta.height ?? 0);
    // トリム後が元の10%未満になるのはおかしい（商品が白すぎ）→元を返す
    if (trimArea < origArea * 0.1) return buffer;
    return trimmed;
  } catch {
    return buffer;
  }
}

export async function upscaleImageBuffer(buffer: Buffer): Promise<Buffer> {
  const trimmed = await trimWhiteBorder(buffer);
  const img = sharp(trimmed);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const longer = Math.max(w, h);

  if (longer <= 0) return buffer;

  const scale = longer >= TARGET_LONGER_SIDE ? 1 : TARGET_LONGER_SIDE / longer;
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));

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
  _mimeType = 'image/png',
): Promise<string> {
  const upscaled = await upscaleImageBuffer(buffer);
  return `data:image/png;base64,${upscaled.toString('base64')}`;
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
