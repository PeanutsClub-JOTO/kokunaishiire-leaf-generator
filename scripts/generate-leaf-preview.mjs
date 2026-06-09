import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const templatePath = path.join(root, 'lib/leaf/image-template.html');
const outputPath = path.join(root, 'leaf_theme_preview.html');
const previewDir = path.join(root, 'leaf-theme-previews');
const previewImages = {
  cup: `file://${path.join(root, 'public/preview-products/popcorn-cup.jpg')}`,
  assort: `file://${path.join(root, 'public/preview-products/popcorn-assort.jpg')}`,
  bag: `file://${path.join(root, 'public/preview-products/popcorn-bag.jpg')}`,
};

const templateHtml = fs.readFileSync(templatePath, 'utf8');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[　\s]+/g, ' ')
    .replace(/[！!]{2,}/g, '！')
    .replace(/[？?]{2,}/g, '？')
    .trim();
}

function normalizePieceSize(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return '—';
  return cleaned
    .replace(/[ＷｗWw]\s*/g, '')
    .replace(/[ＤｄDd]\s*/g, '×')
    .replace(/[ＨｈHh]\s*/g, '×')
    .replace(/[×xX✕]\s*/g, '×')
    .replace(/×+/g, '×')
    .replace(/^×|×$/g, '')
    .replace(/\s+/g, '');
}

function formatInteger(n) {
  return Math.round(n).toLocaleString('ja-JP');
}

function imageTag(src, className) {
  if (!src) return '<div class="image-placeholder">商品画像未設定</div>';
  return `<img class="${className}" src="${escapeHtml(src)}" alt="商品画像" />`;
}

function buildHeroImageHtml(data) {
  const images = data.productImages.filter(Boolean);
  if (images.length <= 1) return imageTag(images[0], 'hero-image');
  return `<div class="assort-grid">${images.slice(0, 4).map((src) => imageTag(src, '')).join('')}</div>`;
}

function renderLeaf(data) {
  return templateHtml
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{THEME_CLASS}}', data.themeClass)
    .replaceAll('{{THEME_LABEL}}', data.themeLabel)
    .replaceAll('{{MAIN_COPY}}', escapeHtml(data.mainCopy))
    .replaceAll('{{SALES_COPY}}', escapeHtml(data.salesCopy))
    .replaceAll('{{ASSORT_CLASS}}', data.productImages.length > 1 ? 'assort' : '')
    .replaceAll('{{HERO_IMAGE_HTML}}', buildHeroImageHtml(data))
    .replaceAll('{{SUB_IMAGE_HTML}}', imageTag(data.productImages[0], ''))
    .replaceAll('{{DRAFT_CLASS}}', '')
    .replaceAll('{{STATUS_LABEL}}', '仮リーフ')
    .replaceAll('{{STATUS_NOTE}}', '確認前プレビュー')
    .replaceAll('{{PRODUCT_CODE}}', escapeHtml(data.productCode))
    .replaceAll('{{LEAF_NAME}}', escapeHtml(data.leafName))
    .replaceAll('{{ITEM_COUNT}}', formatInteger(data.itemCount))
    .replaceAll('{{LEAF_QTY}}', formatInteger(data.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', formatInteger(data.wholesalePrice))
    .replaceAll('{{UNIT_PRICE}}', formatInteger(data.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', escapeHtml(normalizePieceSize(data.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', formatInteger(data.shelfLifeDays))
    .replaceAll('{{LEAD_TIME}}', escapeHtml(data.leadTime))
    .replaceAll('{{HALF_LABEL}}', data.isHalfOk ? '可' : '不可')
    .replaceAll('{{PJ_NO}}', escapeHtml(data.pjNo));
}

const base = {
  productCode: 'V1029959-TEST$',
  pjNo: 'Z5324',
  itemCount: 1,
  leafQty: 96,
  wholesalePrice: 34950,
  unitPrice: 364,
  isHalfOk: true,
  leadTime: '受注後約1週間',
  shelfLifeDays: 180,
  pieceSize: 'W160×D160×H55mm',
  productImages: [previewImages.cup],
};

const variants = [
  {
    ...base,
    themeClass: 'theme-fruit',
    themeLabel: 'フルーツ',
    leafName: 'マンゴーひとくちゼリー',
    mainCopy: 'フルーツ感が楽しめる、\n景品向けの商品です！',
    salesCopy: 'フルーツ系のわかりやすさで\n景品として案内しやすい\n商品です。',
    productImages: [previewImages.cup],
  },
  {
    ...base,
    themeClass: 'theme-wagashi',
    themeLabel: '和菓子',
    leafName: '金澤水羊羹詰め合わせ',
    mainCopy: '上品な甘さが楽しめる、\n和菓子系の景品商品です！',
    salesCopy: '落ち着いた雰囲気で\n幅広い層に案内しやすい\n和菓子景品です。',
    productImages: [previewImages.assort],
  },
  {
    ...base,
    themeClass: 'theme-snack',
    themeLabel: 'スナック',
    leafName: 'ポップコーンしお味',
    leafQty: 192,
    wholesalePrice: 31200,
    unitPrice: 163,
    mainCopy: 'パッと目を引く、\n景品向けスナック商品です！',
    salesCopy: 'ゲームセンター景品で\n見映えしやすい、\n手に取りやすい商品です。',
    productImages: [previewImages.bag],
  },
  {
    ...base,
    themeClass: 'theme-sweets',
    themeLabel: 'スイーツ',
    leafName: 'チョコクッキーアソート',
    mainCopy: '甘さと見た目で選びやすい、\nおすすめスイーツです！',
    salesCopy: '甘いもの好きに\n案内しやすい、\n見た目も楽しい商品です。',
    productImages: [previewImages.cup],
  },
  {
    ...base,
    themeClass: 'theme-cool',
    themeLabel: 'さっぱり',
    leafName: '塩レモンゼリー',
    mainCopy: 'さっぱり楽しめる、\n季節感のある商品です！',
    salesCopy: '爽やかな印象で、\n季節提案にも使いやすい\n商品です。',
    productImages: [previewImages.assort],
  },
  {
    ...base,
    themeClass: 'theme-standard',
    themeLabel: 'おすすめ',
    leafName: 'おすすめ景品商品',
    mainCopy: 'おすすめ景品商品です！',
    salesCopy: '景品向けに案内しやすい、\nおすすめの商品です。',
    productImages: [previewImages.bag],
  },
];

const scale = 0.52;
const leaves = variants.map(renderLeaf);
fs.mkdirSync(previewDir, { recursive: true });

const body = leaves.map((leaf, index) => {
  const fileName = `${String(index + 1).padStart(2, '0')}-${variants[index].themeClass.replace('theme-', '')}.html`;
  const filePath = path.join(previewDir, fileName);
  fs.writeFileSync(filePath, leaf, 'utf8');
  return `
  <section class="preview-block">
    <h2>${escapeHtml(variants[index].themeLabel)} / ${escapeHtml(variants[index].leafName)}</h2>
    <div class="frame">
      <iframe src="file://${filePath}"></iframe>
    </div>
  </section>
`;
}).join('\n');

fs.writeFileSync(outputPath, `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<title>リーフ画像テーマプレビュー</title>
<style>
  body {
    margin: 0;
    padding: 32px;
    background: #f4f4f5;
    font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
  }
  h1 {
    margin: 0 0 20px;
    font-size: 24px;
  }
  .preview-block {
    margin: 0 0 38px;
  }
  .preview-block h2 {
    margin: 0 0 10px;
    font-size: 16px;
  }
  .frame {
    width: ${Math.ceil(1540 * scale)}px;
    height: ${Math.ceil(970 * scale)}px;
    overflow: hidden;
    background: white;
    box-shadow: 0 12px 32px rgba(0,0,0,.18);
  }
  iframe {
    width: 1540px;
    height: 970px;
    border: 0;
    transform: scale(${scale});
    transform-origin: top left;
    display: block;
  }
</style>
</head>
<body>
<h1>リーフ画像テーマプレビュー</h1>
${body}
</body>
</html>
`, 'utf8');

console.log(outputPath);
