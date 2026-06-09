// 実見積データ相当のリーフ画像を Puppeteer で PNG レンダリングして目視確認する開発用スクリプト。
//   node scripts/render-real-leaf.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const root = process.cwd();
const templateHtml = fs.readFileSync(path.join(root, 'lib/leaf/image-template.html'), 'utf8');
// ローカル file:// は Puppeteer で読めないことがあるため data URI で埋め込む
const img = (n) => {
  const b = fs.readFileSync(path.join(root, 'public/preview-products', n));
  return `data:image/jpeg;base64,${b.toString('base64')}`;
};

const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const sizeMm = (d) => {
  const s = String(d).replace(/[WＷ]/g,'').replace(/[DＤHＨ]/g,'×').replace(/×+/g,'×').replace(/^×|×$/g,'');
  return /[a-zA-Z]/.test(s) ? s : `${s}mm`;
};

// kanazawa ① と ⑫ を実抽出値で再現（cost/leafQty 等はエンジン計算後の想定値）
const cases = [
  {
    themeClass: 'theme-wagashi', themeLabel: '和菓子',
    leafName: 'YL-6P塩レモンゼリーギフト',
    mainCopy: 'さっぱり楽しめる、\n季節感のある和菓子ギフトです！',
    salesCopy: '上品な甘さで\n幅広い層に案内しやすい\n景品ギフトです。',
    itemCount: 1, leafQty: 12, wholesale: 9000, unit: 750, half: '可',
    pieceSize: 'W170×D62×H240', shelf: 180, lead: '受注後約1週間', pj: 'Z5324',
    code: 'V1029959-1248A$', images: [img('popcorn-cup.jpg')],
  },
  {
    themeClass: 'theme-fruit', themeLabel: 'フルーツ',
    leafName: '涼ごこちフルーツゼリー6種アソート',
    mainCopy: '6種類の果実感が同時に楽しめる、\n夏にぴったりのゼリーアソートです！',
    salesCopy: '果実ごとの彩りで\n景品として案内しやすい\nアソート企画です。',
    itemCount: 6, leafQty: 60, wholesale: 11250, unit: 187, half: '可',
    pieceSize: 'W73×D73×H73', shelf: 240, lead: '受注後約1週間', pj: 'Z5324',
    code: 'V1029960-1310A$', images: [img('popcorn-cup.jpg'), img('popcorn-bag.jpg'), img('popcorn-assort.jpg'), img('popcorn-cup.jpg')],
  },
];

function render(c) {
  const isAssort = c.images.length > 1;
  const hero = isAssort
    ? `<div class="assort-grid">${c.images.slice(0,4).map((s)=>`<img src="${esc(s)}" alt="" />`).join('')}</div>`
    : `<img class="hero-image" src="${esc(c.images[0])}" alt="" />`;
  return templateHtml
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{THEME_CLASS}}', c.themeClass)
    .replaceAll('{{THEME_LABEL}}', esc(c.themeLabel))
    .replaceAll('{{MAIN_COPY}}', esc(c.mainCopy))
    .replaceAll('{{SALES_COPY}}', esc(c.salesCopy))
    .replaceAll('{{ASSORT_CLASS}}', isAssort ? 'assort' : '')
    .replaceAll('{{HERO_IMAGE_HTML}}', hero)
    .replaceAll('{{SUB_IMAGE_HTML}}', `<img src="${esc(c.images[0])}" alt="" />`)
    .replaceAll('{{DRAFT_CLASS}}', '')
    .replaceAll('{{STATUS_LABEL}}', '仮リーフ')
    .replaceAll('{{STATUS_NOTE}}', 'コード入力前')
    .replaceAll('{{PRODUCT_CODE}}', esc(c.code))
    .replaceAll('{{LEAF_NAME}}', esc(c.leafName))
    .replaceAll('{{ITEM_COUNT}}', fmt(c.itemCount))
    .replaceAll('{{LEAF_QTY}}', fmt(c.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', fmt(c.wholesale))
    .replaceAll('{{UNIT_PRICE}}', fmt(c.unit))
    .replaceAll('{{PIECE_SIZE}}', esc(sizeMm(c.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', fmt(c.shelf))
    .replaceAll('{{LEAD_TIME}}', esc(c.lead))
    .replaceAll('{{HALF_LABEL}}', c.half)
    .replaceAll('{{PJ_NO}}', esc(c.pj));
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
const outDir = path.join(root, 'leaf-render-out');
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < cases.length; i++) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 1 });
  await page.setContent(render(cases[i]), { waitUntil: 'load' });
  await page.evaluateHandle('document.fonts.ready');
  const out = path.join(outDir, `${i+1}-${cases[i].themeClass.replace('theme-','')}.png`);
  await page.screenshot({ path: out, type: 'png' });
  console.log(out);
  await page.close();
}
await browser.close();
