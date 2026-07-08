/**
 * リーフ画像生成 (横長販促画像)
 *
 * 最終出力は営業確認・メール添付向けの PNG。
 * API リクエスト内で長時間レンダリングしないよう、本番ではワーカーへ委譲する。
 *
 * レイアウト方針（参考リーフレット準拠）:
 *   - 上部: キャッチコピー（大・太字・左寄せ）
 *   - 中央: 商品画像を大きく直置き（枠・カードなし）
 *   - 下部: 固定情報バー（商品名・入数・卸価格・単価・サイズ・賞味期限・ハーフ）
 *   - 背景: Imagen3 AI生成（カテゴリ別雰囲気）or CSSストライプ
 */
import * as fs from 'fs';
import * as path from 'path';
import { escapeHtml } from './generate-pdf';
import { timeoutMsFromEnv, withTimeout } from '../async/timeout';

export type LeafletImageData = {
  id: string;
  status: 'draft' | 'final';
  leafName: string;
  productCode: string | null;
  pjNo: string | null;
  itemCount: number;
  leafQty: number;
  wholesalePrice: number;
  unitPrice: number;
  isHalfOk: boolean;
  leadTime: string;
  shelfLifeDays: number;
  pieceSize: string | null;
  note: string | null;
  /** アソート構成商品の品名。背景/コピー生成時に使用する */
  productNames?: string[];
  /** 見積書から抽出した商品画像（data URL または絶対パス）*/
  productImages: string[];
  flagMessages: string[];
  /** AI生成キャッチコピー（未設定ならルールベースにフォールバック） */
  catchphrase?: { main_copy: string; sub_copy: string } | null;
  /** AI生成背景画像のデータURL（未設定ならCSSストライプ） */
  aiBgDataUrl?: string | null;
};

export type GenerateImageResult = {
  buffer: Buffer;
  contentType: 'image/png';
};

/* ─── ユーティリティ ─── */

function formatInteger(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[　\s]+/g, ' ')
    .replace(/[！!]{2,}/g, '！')
    .replace(/[？?]{2,}/g, '？')
    .trim();
}

function normalizePieceSize(value: string | null | undefined): string {
  const cleaned = cleanText(value);
  if (!cleaned) return '—';
  const dims = cleaned
    .replace(/[ＷｗWw]\s*/g, '')
    .replace(/[ＤｄDd]\s*/g, '×')
    .replace(/[ＨｈHh]\s*/g, '×')
    .replace(/[×xX✕]\s*/g, '×')
    .replace(/×+/g, '×')
    .replace(/^×|×$/g, '')
    .replace(/\s+/g, '');
  if (!dims) return '—';
  return /[a-zA-Zｍｃ㎜㎝]/.test(dims) ? dims : `${dims}mm`;
}

/* ─── テーマ選択 ─── */

export type LeafTheme = {
  className: string;
  label: string;
};

function textForTheme(data: LeafletImageData): string {
  return cleanText(`${data.leafName} ${data.note ?? ''}`);
}

export function selectLeafTheme(data: LeafletImageData): LeafTheme {
  const text = textForTheme(data);

  if (/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|餡|最中|もなか|まんじゅう|饅頭|どら焼|団子|大福|あられ|おかき|かりんとう|せんべい|煎餅|わらび|金澤|金沢/.test(text)) {
    return { className: 'theme-wagashi', label: '和菓子' };
  }
  if (/ポップコーン|スナック|ポテト|チップ|コーン|スティック|ナッツ|豆菓子|揚げ|しお味|塩味|うす塩|コンソメ/.test(text)) {
    return { className: 'theme-snack', label: 'スナック' };
  }
  if (/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|フィナンシェ|マドレーヌ|パイ|タルト|ドーナツ|カステラ|ワッフル|ラスク|キャンディ|キャンデー|飴|グミ|マシュマロ/.test(text)) {
    return { className: 'theme-sweets', label: 'スイーツ' };
  }
  if (/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|サイダー|ラムネ|ミント|乳酸|シャーベット|アイス|カルピス/.test(text)) {
    return { className: 'theme-cool', label: 'さっぱり' };
  }
  if (/マンゴー|ゼリー|果|フルーツ|桃|みかん|オレンジ|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|林檎|梨|メロン|パイン|キウイ|さくらんぼ|ベリー|柑橘|ピーチ/.test(text)) {
    return { className: 'theme-fruit', label: 'フルーツ' };
  }
  return { className: 'theme-standard', label: 'おすすめ' };
}

/* ─── キャッチコピー（ルールベース） ─── */

const COPY_CATEGORIES: Array<[RegExp, string]> = [
  [/ポップコーン/, 'ポップコーン'],
  [/水羊羹|水ようかん/, '水羊羹'],
  [/羊羹|ようかん/, '羊羹'],
  [/カステラ/, 'カステラ'],
  [/バウム/, 'バウムクーヘン'],
  [/ケーキ/, 'ケーキ'],
  [/クッキー/, 'クッキー'],
  [/ムース/, 'ムース'],
  [/プリン/, 'プリン'],
  [/ゼリー/, 'ゼリー'],
  [/最中|もなか/, '最中'],
  [/まんじゅう|饅頭/, 'まんじゅう'],
  [/せんべい|煎餅/, 'せんべい'],
  [/チョコ|ショコラ/, 'チョコ'],
  [/グミ/, 'グミ'],
  [/アイス|シャーベット/, 'アイス'],
];

export function detectCategory(name: string): string {
  for (const [re, label] of COPY_CATEGORIES) if (re.test(name)) return label;
  return '商品';
}

export function flavorOf(name: string): string {
  let s = cleanText(name);
  s = s.replace(/^[0-9A-Za-zＡ-Ｚ＿\-－]+[PpＰ]?(?=[ぁ-んァ-ヶ一-龠])/, '');
  s = s.replace(/(ギフト|ｷﾞﾌﾄ|詰合せ|詰め合わせ|セット)$/g, '');
  for (const [re] of COPY_CATEGORIES) {
    s = s.replace(new RegExp(`(?:${re.source})$`), '');
  }
  return s.trim();
}

function buildMainCopy(data: LeafletImageData): string {
  const name = cleanText(data.leafName);
  if (data.itemCount >= 2) {
    const parts = name.split('・').map((n) => detectCategory(n));
    const uniq = Array.from(new Set(parts));
    const cat = uniq.length === 1 && uniq[0] !== '商品' ? uniq[0] : '味';
    return `${data.itemCount}種類の${cat}が一度に楽しめる、\nアソート企画です！`;
  }
  const cat = detectCategory(name);
  const fl = flavorOf(name);
  if (fl && cat !== '商品') return `${fl}の${cat}が楽しめる、\n景品向けの商品です！`;
  if (fl) return `${fl}！`;
  return `${name}です！`;
}

/* ─── 商品画像 HTML 生成 ─── */

/**
 * 画像ソースを img タグに変換
 */
function imgTag(src: string): string {
  return `<div class="img-slot"><img src="${escapeHtml(src)}" alt="商品画像" loading="eager" /></div>`;
}

/**
 * 商品点数に応じた product-area クラスと img タグ群を生成
 */
export function buildProductImagesHtml(productImages: string[]): {
  areaClass: string;
  imagesHtml: string;
} {
  const images = productImages.filter(Boolean);

  if (images.length === 0) {
    return {
      areaClass: 'single',
      imagesHtml: '<div class="img-placeholder">商品画像未設定</div>',
    };
  }
  if (images.length === 1) {
    return { areaClass: 'single', imagesHtml: imgTag(images[0]) };
  }
  if (images.length === 2) {
    return { areaClass: 'assort-2', imagesHtml: images.map(imgTag).join('') };
  }
  if (images.length === 3) {
    return { areaClass: 'assort-3', imagesHtml: images.slice(0, 3).map(imgTag).join('') };
  }
  // 4種以上は最大4枚を2×2グリッド
  return { areaClass: 'assort-4', imagesHtml: images.slice(0, 4).map(imgTag).join('') };
}

/* ─── HTML 組み立て ─── */

export function buildLeafImageHtml(
  data: LeafletImageData,
  templateHtml: string,
  fontUrl = '',
): string {
  const isDraft = data.status === 'draft';
  const productCode = cleanText(data.productCode) || '商品コード未設定';
  const pjNo = cleanText(data.pjNo) || '未設定';

  // AI生成コピーを優先、なければルールベース
  const mainCopy = data.catchphrase?.main_copy ?? buildMainCopy(data);

  const theme = selectLeafTheme(data);

  // AI生成背景を inline style で注入（CSSストライプを上書き）
  const aiBgStyle = data.aiBgDataUrl
    ? `background-image:url('${data.aiBgDataUrl}');background-size:cover;background-position:center;opacity:0.92;`
    : '';

  const { areaClass, imagesHtml } = buildProductImagesHtml(data.productImages);
  const salesCopy = cleanText(data.note);

  return templateHtml
    .replaceAll('{{FONT_URL}}', fontUrl)
    .replaceAll('{{THEME_CLASS}}', theme.className)
    .replaceAll('{{THEME_LABEL}}', escapeHtml(theme.label))
    .replaceAll('{{AI_BG_STYLE}}', aiBgStyle)
    .replaceAll('{{MAIN_COPY}}', escapeHtml(mainCopy))
    .replaceAll('{{SALES_COPY}}', escapeHtml(salesCopy))
    .replaceAll('{{PRODUCT_AREA_CLASS}}', areaClass)
    .replaceAll('{{PRODUCT_IMAGES_HTML}}', imagesHtml)  // エスケープ不要（img タグを含むため）
    .replaceAll('{{DRAFT_CLASS}}', isDraft ? '' : 'hidden')
    .replaceAll('{{STATUS_LABEL}}', isDraft ? '仮リーフ' : '確認済み')
    .replaceAll('{{PRODUCT_CODE}}', escapeHtml(productCode))
    .replaceAll('{{LEAF_NAME}}', escapeHtml(cleanText(data.leafName) || '商品名未設定'))
    .replaceAll('{{ITEM_COUNT}}', formatInteger(data.itemCount))
    .replaceAll('{{LEAF_QTY}}', formatInteger(data.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', formatInteger(data.wholesalePrice))
    .replaceAll('{{UNIT_PRICE}}', formatInteger(data.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', escapeHtml(normalizePieceSize(data.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', formatInteger(data.shelfLifeDays))
    .replaceAll('{{LEAD_TIME}}', escapeHtml(cleanText(data.leadTime) || '受注後約1週間'))
    .replaceAll('{{HALF_LABEL}}', data.isHalfOk ? '可' : '不可')
    .replaceAll('{{HALF_NG_CLASS}}', data.isHalfOk ? '' : 'ng')
    .replaceAll('{{PJ_NO}}', escapeHtml(pjNo));
}

/* ─── 画像生成エントリ ─── */

export async function generateLeafImage(
  data: LeafletImageData,
): Promise<GenerateImageResult> {
  const workerUrl = process.env.WORKER_BASE_URL;

  if (workerUrl) {
    const res = await fetch(`${workerUrl}/render/leaf-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Worker image generation failed: ${msg}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType: 'image/png' };
  }

  return generateLeafImageLocal(data);
}

export async function generateLeafImageLocal(
  data: LeafletImageData,
): Promise<GenerateImageResult> {
  const puppeteer = await import('puppeteer');
  const launchTimeout = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS ?? 60_000);

  const templatePath = path.join(process.cwd(), 'lib/leaf/image-template.html');
  const templateHtml = fs.readFileSync(templatePath, 'utf-8');
  const html = buildLeafImageHtml(data, templateHtml);

  const browser = await puppeteer.default.launch({
    headless: true,
    timeout: launchTimeout,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluateHandle('document.fonts.ready');
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
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    return { buffer: Buffer.from(screenshot), contentType: 'image/png' };
  } finally {
    await browser.close();
  }
}
