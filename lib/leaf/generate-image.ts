/**
 * リーフ画像生成 (横長販促画像)
 *
 * 最終出力は営業確認・メール添付向けの PNG/JPEG。
 * API リクエスト内で長時間レンダリングしないよう、本番ではワーカーへ委譲する。
 */
import * as fs from 'fs';
import * as path from 'path';
import { escapeHtml } from './generate-pdf';

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
  productImages: string[];
  flagMessages: string[];
};

export type GenerateImageResult = {
  buffer: Buffer;
  contentType: 'image/png';
};

type LeafTheme = {
  className: string;
  label: string;
};

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
  // 既に mm/cm 等の単位が含まれていなければ mm を補う（参考リーフ表記に合わせる）
  return /[a-zA-Zｍｃ㎜㎝]/.test(dims) ? dims : `${dims}mm`;
}

function textForTheme(data: LeafletImageData): string {
  return cleanText(`${data.leafName} ${data.note ?? ''}`);
}

export function selectLeafTheme(data: LeafletImageData): LeafTheme {
  const text = textForTheme(data);

  // 和菓子系（羊羹・あんこ・米菓・和スイーツ）
  if (/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|餡|最中|もなか|まんじゅう|饅頭|どら焼|団子|大福|あられ|おかき|かりんとう|せんべい|煎餅|わらび|金澤|金沢/.test(text)) {
    return { className: 'theme-wagashi', label: '和菓子' };
  }
  // スナック系（ポップコーン・揚げ菓子・豆菓子）
  if (/ポップコーン|スナック|ポテト|チップ|コーン|スティック|ナッツ|豆菓子|揚げ|しお味|塩味|うす塩|コンソメ/.test(text)) {
    return { className: 'theme-snack', label: 'スナック' };
  }
  // 洋菓子・焼き菓子・チョコ系
  if (/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|フィナンシェ|マドレーヌ|パイ|タルト|ドーナツ|カステラ|ワッフル|ラスク|キャンディ|キャンデー|飴|グミ|マシュマロ/.test(text)) {
    return { className: 'theme-sweets', label: 'スイーツ' };
  }
  // 涼感・乳系・さっぱり系
  if (/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|サイダー|ラムネ|ミント|乳酸|シャーベット|アイス/.test(text)) {
    return { className: 'theme-cool', label: 'さっぱり' };
  }
  // フルーツ・ゼリー系
  if (/マンゴー|ゼリー|果|フルーツ|桃|みかん|オレンジ|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|林檎|梨|メロン|パイン|キウイ|さくらんぼ|ベリー|柑橘|ピーチ/.test(text)) {
    return { className: 'theme-fruit', label: 'フルーツ' };
  }
  return { className: 'theme-standard', label: 'おすすめ' };
}

// 商品カテゴリ辞書（商品名 → 表示カテゴリ）
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
];

function detectCategory(name: string): string {
  for (const [re, label] of COPY_CATEGORIES) if (re.test(name)) return label;
  return '商品';
}

/** 商品名から品番・接尾辞・カテゴリ語を除いた「味・産地」フレーズを取り出す */
function flavorOf(name: string): string {
  let s = cleanText(name);
  // 先頭の品番（YL-6P / ICR-7P / JKR-10 など）を除去
  s = s.replace(/^[0-9A-Za-zＡ-Ｚ＿\-－]+[PpＰ]?(?=[ぁ-んァ-ヶ一-龠])/, '');
  // 末尾の汎用語を除去
  s = s.replace(/(ギフト|ｷﾞﾌﾄ|詰合せ|詰め合わせ|セット)$/g, '');
  // 末尾のカテゴリ語を除去（「塩レモンゼリー」→「塩レモン」）
  for (const [re] of COPY_CATEGORIES) {
    s = s.replace(new RegExp(`(?:${re.source})$`), '');
  }
  return s.trim();
}

function buildMainCopy(data: LeafletImageData): string {
  const name = cleanText(data.leafName);
  if (data.itemCount >= 2) {
    // アソート: 構成商品の共通カテゴリ（無ければ「味」）で訴求
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

function buildSalesCopy(data: LeafletImageData): string {
  const note = cleanText(data.note);
  if (note) return note;
  const name = cleanText(data.leafName);
  if (data.itemCount >= 2) {
    // アソート: 構成商品の味を列挙
    const flavors = name
      .split('・')
      .map((n) => flavorOf(n) || cleanText(n))
      .filter(Boolean);
    const listed = flavors.slice(0, 4).join('・');
    return `${listed}${flavors.length > 4 ? ' ほか' : ''}の\n${data.itemCount}種アソートです。\n景品として案内しやすい企画です。`;
  }
  const cat = detectCategory(name);
  const fl = flavorOf(name);
  const lead = fl ? `${fl}の${cat}。\n` : '';
  const theme = selectLeafTheme(data).className;
  if (theme === 'theme-wagashi') return `${lead}落ち着いた雰囲気で\n幅広い層に案内しやすい\n和菓子景品です。`;
  if (theme === 'theme-snack') return `${lead}見映えしやすく\n手に取りやすい\n景品向け商品です。`;
  if (theme === 'theme-sweets') return `${lead}甘いもの好きに\n案内しやすい商品です。`;
  if (theme === 'theme-cool') return `${lead}爽やかな印象で\n季節提案にも使いやすい\n商品です。`;
  if (theme === 'theme-fruit') return `${lead}フルーツ感が分かりやすく\n景品として案内しやすい\n商品です。`;
  return `${lead}景品向けに案内しやすい\nおすすめの商品です。`;
}

function imageTag(src: string | undefined, className: string): string {
  if (!src) return '<div class="image-placeholder">商品画像未設定</div>';
  return `<img class="${className}" src="${escapeHtml(src)}" alt="商品画像" />`;
}

function buildHeroImageHtml(data: LeafletImageData): string {
  const images = data.productImages.filter(Boolean);
  if (images.length <= 1) return imageTag(images[0], 'hero-image');

  const visibleImages = images.slice(0, 4);
  return `<div class="assort-grid">${visibleImages
    .map((src) => imageTag(src, ''))
    .join('')}</div>`;
}

export function buildLeafImageHtml(
  data: LeafletImageData,
  templateHtml: string,
  fontUrl = '',
): string {
  const isDraft = data.status === 'draft';
  const productCode = cleanText(data.productCode) || '商品コード未設定';
  const pjNo = cleanText(data.pjNo) || '未設定';
  const mainCopy = buildMainCopy(data);
  const salesCopy = buildSalesCopy(data);
  const firstImage = data.productImages.find(Boolean);
  const theme = selectLeafTheme(data);

  return templateHtml
    .replaceAll('{{FONT_URL}}', fontUrl)
    .replaceAll('{{THEME_CLASS}}', theme.className)
    .replaceAll('{{THEME_LABEL}}', escapeHtml(theme.label))
    .replaceAll('{{MAIN_COPY}}', escapeHtml(mainCopy))
    .replaceAll('{{SALES_COPY}}', escapeHtml(salesCopy))
    .replaceAll('{{ASSORT_CLASS}}', data.productImages.length > 1 ? 'assort' : '')
    .replaceAll('{{HERO_IMAGE_HTML}}', buildHeroImageHtml(data))
    .replaceAll('{{SUB_IMAGE_HTML}}', imageTag(firstImage, ''))
    .replaceAll('{{DRAFT_CLASS}}', isDraft ? '' : 'hidden')
    .replaceAll('{{STATUS_LABEL}}', isDraft ? '仮リーフ' : '正式リーフ')
    .replaceAll('{{STATUS_NOTE}}', isDraft ? 'コード入力前' : '確認済み')
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
    .replaceAll('{{PJ_NO}}', escapeHtml(pjNo));
}

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
    await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    await page.evaluateHandle('document.fonts.ready');
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
    });
    return { buffer: Buffer.from(screenshot), contentType: 'image/png' };
  } finally {
    await browser.close();
  }
}
