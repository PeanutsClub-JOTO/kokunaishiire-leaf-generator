/**
 * Puppeteer PDF レンダリング HTTP サーバ (Railway 常駐)
 *
 * POST /render/leaf        body: LeafletData (JSON)
 * → application/pdf レスポンス
 * POST /render/leaf-image  body: LeafletImageData (JSON)
 * → image/png レスポンス
 */
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'puppeteer';
import type { LeafletData } from '../../lib/leaf/generate-pdf';
import { buildHtml } from '../../lib/leaf/generate-pdf';
import type { LeafletImageData } from '../../lib/leaf/generate-image';
import { buildLeafImageHtml } from '../../lib/leaf/generate-image';
import { timeoutMsFromEnv, withTimeout } from '../../lib/async/timeout';

const PORT = parseInt(process.env.RENDERER_PORT ?? '3001', 10);
const TEMPLATE_PATH = path.join(__dirname, '../../lib/leaf/template.html');
const IMAGE_TEMPLATE_PATH = path.join(__dirname, '../../lib/leaf/image-template.html');

// Noto Sans JP フォントは Railway 上では Web フォント CDN から読み込む
// （公開フォント URL か Supabase Storage の公開パスを想定）
const FONT_URL = process.env.NOTO_FONT_URL ?? '';
const LAUNCH_TIMEOUT = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS ?? 60_000);

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer');
  browserPromise ??= puppeteer.default.launch({
    headless: true,
    timeout: LAUNCH_TIMEOUT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });
  return browserPromise;
}

export async function renderLeafPdfBuffer(data: LeafletData): Promise<Buffer> {
  const templateHtml = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const html = buildHtml(data, templateHtml, FONT_URL);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function renderLeafImageBuffer(data: LeafletImageData): Promise<Buffer> {
  const templateHtml = fs.readFileSync(IMAGE_TEMPLATE_PATH, 'utf-8');
  const html = buildLeafImageHtml(data, templateHtml, FONT_URL);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.evaluateHandle('document.fonts.ready');
    // 全 <img> が読み込まれるまで待機（外部URL画像対応）
    await withTimeout(
      page.evaluate(() =>
        Promise.all(
          [...document.querySelectorAll('img')].map((img) =>
            (img as HTMLImageElement).complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve());
                  img.addEventListener('error', () => resolve());
                }),
          ),
        ),
      ),
      timeoutMsFromEnv('RENDER_IMAGE_LOAD_TIMEOUT_MS', 12_000),
      'Leaflet image asset loading',
    );
    const image = await page.screenshot({
      type: 'png',
      fullPage: false,
    });
    return Buffer.from(image);
  } finally {
    await page.close();
  }
}

export function startRendererServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || (req.url !== '/render/leaf' && req.url !== '/render/leaf-image')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString();
        if (req.url === '/render/leaf-image') {
          const body = JSON.parse(rawBody) as LeafletImageData;
          const imageBuffer = await renderLeafImageBuffer(body);
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': imageBuffer.length });
          res.end(imageBuffer);
          return;
        }

        const body = JSON.parse(rawBody) as LeafletData;
        const pdfBuffer = await renderLeafPdfBuffer(body);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfBuffer.length });
        res.end(pdfBuffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[renderer] Error:', msg);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(msg);
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`[renderer] Listening on port ${PORT}`);
  });

  return server;
}
