import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { upscaleImageBuffer, upscaleToDataUrl } from './upscale-image';

describe('upscale image', () => {
  it('小さい商品画像を長辺1600pxまでアップスケールしてPNGにする', async () => {
    const input = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: '#ffffff',
      },
    }).png().toBuffer();

    const output = await upscaleImageBuffer(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800);
  });

  it('データURLのMIMEをPNGに揃える', async () => {
    const input = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: '#000000',
      },
    }).jpeg().toBuffer();

    const dataUrl = await upscaleToDataUrl(input, 'image/jpeg');

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
