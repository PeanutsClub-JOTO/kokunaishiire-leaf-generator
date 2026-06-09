/**
 * リーフPDF生成 (仕様書 v2.1 §F-4)
 *
 * Puppeteer は Vercel サーバレス単体では動作しないため、
 * Railway ワーカー (worker/leaf-renderer/render.ts) へ HTTP リクエストを委譲する。
 * WORKER_BASE_URL が未設定の場合はローカル Puppeteer で実行（開発環境用）。
 */
import * as fs from 'fs';
import * as path from 'path';

export type LeafletData = {
  // 識別
  id: string;
  status: 'draft' | 'final';
  // 商品情報
  leafName: string;
  productCode: string | null;
  pjNo: string | null;
  itemCount: number;
  leafQty: number;
  costTotal: number;
  wholesalePrice: number;
  unitPrice: number;
  isHalfOk: boolean;
  leadTime: string;
  shelfLifeDays: number;
  pieceSize: string | null;
  janCode: string | null;
  note: string | null;
  imageUrl: string | null;
  flagMessages: string[];
};

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(n: number): string {
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

export function buildHtml(data: LeafletData, templateHtml: string, fontUrl: string): string {
  const isDraft = data.status === 'draft';
  const isDirect = data.productCode?.endsWith('$') ?? false;

  const imageHtml = data.imageUrl
    ? `<img src="${escapeHtml(data.imageUrl)}" alt="商品画像" />`
    : `<div class="image-placeholder">画像なし</div>`;

  return templateHtml
    .replace('{{FONT_URL}}', fontUrl)
    .replace('{{LEAF_NAME}}', escapeHtml(data.leafName))
    .replace('{{DRAFT_DISPLAY}}', isDraft ? 'inline-block' : 'none')
    .replace('{{PRODUCT_CODE}}', escapeHtml(data.productCode ?? '（未入力）'))
    .replace('{{DIRECT_DISPLAY}}', isDirect ? 'inline-block' : 'none')
    .replace('{{IMAGE_HTML}}', imageHtml)
    .replace('{{ITEM_COUNT}}', String(data.itemCount))
    .replace('{{LEAF_QTY}}', String(data.leafQty))
    .replace('{{PIECE_SIZE}}', escapeHtml(data.pieceSize ?? '—'))
    .replace('{{SHELF_LIFE_DAYS}}', String(data.shelfLifeDays))
    .replace('{{LEAD_TIME}}', escapeHtml(data.leadTime))
    .replace('{{JAN_CODE}}', escapeHtml(data.janCode ?? '—'))
    .replace('{{PJ_NO}}', escapeHtml(data.pjNo ?? '（未入力）'))
    .replace('{{COST_TOTAL}}', formatNumber(data.costTotal))
    .replace('{{WHOLESALE_PRICE}}', formatNumber(data.wholesalePrice))
    .replace('{{UNIT_PRICE}}', formatNumber(data.unitPrice))
    .replace('{{HALF_DISPLAY}}', data.isHalfOk ? 'inline-block' : 'none')
    .replace('{{FLAGS_DISPLAY}}', data.flagMessages.length > 0 ? 'block' : 'none')
    .replace('{{FLAGS_TEXT}}', escapeHtml(data.flagMessages.join(' / ')))
    .replace('{{NOTE_DISPLAY}}', data.note ? 'block' : 'none')
    .replace('{{NOTE}}', escapeHtml(data.note ?? ''))
    .replace('{{GENERATED_AT}}', new Date().toLocaleDateString('ja-JP'))
    .replace('{{STATUS}}', isDraft ? '仮リーフ' : '正式');
}

export type GeneratePdfResult = {
  buffer: Buffer;
};

/**
 * Railwayワーカーにリクエストを投げてPDFを取得する。
 * WORKER_BASE_URL 未設定時はローカルPuppeteerで生成（開発用）。
 */
export async function generateLeafPdf(
  data: LeafletData,
): Promise<GeneratePdfResult> {
  const workerUrl = process.env.WORKER_BASE_URL;

  if (workerUrl) {
    // 本番: Railway ワーカーへ委譲
    const res = await fetch(`${workerUrl}/render/leaf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Worker PDF generation failed: ${msg}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer) };
  }

  // 開発: ローカルPuppeteer
  return generateLeafPdfLocal(data);
}

async function generateLeafPdfLocal(
  data: LeafletData,
): Promise<GeneratePdfResult> {
  // 動的インポートで Puppeteer をロード（サーバサイドのみ）
  const puppeteer = await import('puppeteer');

  const templatePath = path.join(process.cwd(), 'lib/leaf/template.html');
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');

  // 開発環境ではフォントを省略（文字化け許容）
  const fontUrl = '';

  const html = buildHtml(data, templateHtml, fontUrl);

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return { buffer: Buffer.from(buffer) };
  } finally {
    await browser.close();
  }
}
