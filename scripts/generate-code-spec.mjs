import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'docs');
const outputPath = path.join(outputDir, '企画業務自動化システム_コード付き実装仕様書.md');

const files = [
  'package.json',
  'README.md',
  'app/globals.css',
  'app/layout.tsx',
  'app/page.tsx',
  'app/api/quotations/route.ts',
  'app/api/products/route.ts',
  'app/api/assort/route.ts',
  'app/api/assort/[groupId]/recalc/route.ts',
  'app/api/jobs/[id]/route.ts',
  'app/api/leaflets/[id]/route.ts',
  'app/api/leaflets/[id]/pdf/route.ts',
  'app/api/leaflets/[id]/image/route.ts',
  'app/quotations/[id]/products/page.tsx',
  'app/quotations/[id]/assort/page.tsx',
  'app/quotations/[id]/leaflets/[groupId]/page.tsx',
  'components/UploadForm.tsx',
  'components/AssortGroupEditor.tsx',
  'components/LeafletFinalizeForm.tsx',
  'lib/calc/engine.ts',
  'lib/calc/engine.test.ts',
  'lib/assort/grouping.ts',
  'lib/assort/grouping.test.ts',
  'lib/assort/ai-assist.ts',
  'lib/assort/ai-assist.test.ts',
  'lib/parse/irisu.ts',
  'lib/parse/irisu.test.ts',
  'lib/parse/minlot.ts',
  'lib/parse/minlot.test.ts',
  'lib/parse/spec.ts',
  'lib/parse/spec.test.ts',
  'lib/parse/sales-period.ts',
  'lib/parse/sales-period.test.ts',
  'lib/import/xlsx-cells.ts',
  'lib/import/xlsx-cells.test.ts',
  'lib/import/xlsx-images.ts',
  'lib/import/xlsx-images.test.ts',
  'lib/import/pdf-table.ts',
  'lib/import/pdf-image-llm.ts',
  'lib/import/pdf-image-llm.test.ts',
  'lib/import/gsheet.ts',
  'lib/import/gsheet.test.ts',
  'lib/leaf/generate-pdf.ts',
  'lib/leaf/generate-pdf.test.ts',
  'lib/leaf/template.html',
  'lib/leaf/generate-image.ts',
  'lib/leaf/generate-image.test.ts',
  'lib/leaf/image-template.html',
  'lib/leaf/load-data.ts',
  'lib/llm/types.ts',
  'lib/llm/gemini.ts',
  'lib/supabase/client.ts',
  'lib/supabase/types.ts',
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_leaflet_image_generation.sql',
  'worker/index.ts',
  'worker/handlers/import-xlsx.ts',
  'worker/handlers/import-pdf.ts',
  'worker/handlers/render-leaflet-image.ts',
  'worker/leaf-renderer/render.ts',
  'worker/tsconfig.json',
  'scripts/generate-leaf-preview.mjs',
  'scripts/pdf_extract.py',
  'vitest.config.ts',
  'next.config.ts',
  'tsconfig.json',
  'postcss.config.mjs',
];

function extToLang(file) {
  const ext = path.extname(file);
  if (ext === '.ts' || ext === '.tsx') return 'ts';
  if (ext === '.mjs' || ext === '.js') return 'js';
  if (ext === '.json') return 'json';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.sql') return 'sql';
  if (ext === '.py') return 'py';
  if (ext === '.md') return 'md';
  return '';
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').replaceAll('```', '``\u200b`');
}

function lineCount(text) {
  return text.length === 0 ? 0 : text.split('\n').length;
}

const existingFiles = files.filter((file) => fs.existsSync(path.join(root, file)));
const fileRows = existingFiles.map((file) => {
  const text = read(file);
  return `| \`${file}\` | ${lineCount(text)} |`;
});

const codeAppendix = existingFiles.map((file) => {
  const text = read(file);
  return `### ${file}\n\n\`\`\`${extToLang(file)}\n${text}\n\`\`\`\n`;
}).join('\n');

const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

const doc = `# 企画業務自動化システム コード付き実装仕様書

作成日時: ${now}

この文書は、現在の企画システム実装をAIエディタや開発者に引き継ぐためのコード付き仕様書です。

## 1. システム概要

メーカー見積書の商品情報をもとに、ゲームセンター向けの商品企画業務を支援します。

主な処理は以下です。

1. 見積書、商品情報、商品画像を取り込む
2. 金額条件、賞味期限、販売期間を判定する
3. 同一メーカー内でアソート候補を作成する
4. 掲載数量、仕入原価合計、卸価格、単価、ハーフ可否を計算する
5. リーフ掲載情報を作成する
6. 商品コード、PJ番号を人が入力する
7. 営業確認用のリーフ画像を生成する

## 2. 自動化スコープ

### 自動化する

- 金額条件判定
- 最小ロット上限判定
- 賞味期限判定
- 販売期間判定
- アソート候補グルーピング
- アソート比率に基づく再計算
- リーフ掲載情報生成
- リーフ画像生成
- PDF生成
- Excel/PDF/画像PDF取込の土台
- AI補助判定の土台

### 人が行う

- 商品コード作成
- PCSE登録
- アソート対象、比率の最終確認
- リーフ文言、画像、デザインの最終確認
- 営業メール送信前確認
- 景品適性の物理判断

## 3. 主要計算仕様

### 単品サイジング

\`\`\`text
min_lot_price = cost × min_lot_qty
max_lots = floor(cost_cap / min_lot_price)
leaf_qty = max_lots × min_lot_qty
cost_total = cost × leaf_qty
wholesale_price = (cost_total + sales_add) × profit_coef
unit_price = wholesale_price / leaf_qty
is_half_ok = min_lot_price <= half_base
\`\`\`

既定値:

| 項目 | 値 |
|---|---:|
| profit_coef | 1.25 |
| sales_add | 3000 |
| unit_price_cap | 1000 |
| cost_cap | 33000 |
| half_base | 16500 |
| shelf_min_days | 90 |

## 4. リーフ画像仕様

リーフ画像は横長の営業確認用PNGです。

掲載項目:

- 商品画像
- 商品名
- アイテム数
- 入数
- 卸価格
- 単価
- 商品サイズ
- 賞味期限
- 受注後納期
- ハーフ可否
- PJ番号
- 商品コード

商品コードは管理情報なので、リーフ上では最も目立たない表示にしています。

### テーマ

商品名、備考から以下のテーマを自動選択します。

- フルーツ、ゼリー系
- 和菓子系
- スナック、ポップコーン系
- チョコ、焼菓子系
- 涼感、ヨーグルト、レモン系
- 標準

実装:

- \`lib/leaf/generate-image.ts\`
- \`lib/leaf/image-template.html\`

## 5. ワーカー仕様

Puppeteerによるリーフ画像生成は重いため、APIリクエスト内で直接実行せず、ジョブ登録してワーカーで処理します。

\`\`\`text
画面
  ↓
POST /api/leaflets/[id]/image
  ↓
jobs に render_leaflet_image を登録
  ↓
worker が処理
  ↓
PNG生成
  ↓
Supabase Storage leaflet-images に保存
  ↓
leaflets.leaf_image_url を更新
\`\`\`

## 6. データベース

Supabase PostgreSQLを利用します。

Migration:

- \`supabase/migrations/001_initial_schema.sql\`
- \`supabase/migrations/002_leaflet_image_generation.sql\`

Storage bucket:

- \`leaflet-images\`

## 7. 画面/API

主要画面:

- \`/\`: 見積一覧
- \`/quotations/[id]/products\`: 商品一覧、判定結果
- \`/quotations/[id]/assort\`: アソート確認
- \`/quotations/[id]/leaflets/[groupId]\`: リーフ確認、画像生成

主要API:

- \`POST /api/quotations\`
- \`GET /api/products\`
- \`POST /api/assort\`
- \`POST /api/assort/[groupId]/recalc\`
- \`GET /api/jobs/[id]\`
- \`PATCH /api/leaflets/[id]\`
- \`POST /api/leaflets/[id]/pdf\`
- \`POST /api/leaflets/[id]/image\`

## 8. 開発・検証

\`\`\`bash
npm run dev
npm test
npm run build
\`\`\`

注意:

- Next.js 16を使用
- \`npm run build\` は \`next build --webpack\`
- Node実行アーキテクチャと \`node_modules\` のネイティブ依存がズレるとテストやビルドが起動前に落ちる

## 9. コード一覧

| ファイル | 行数 |
|---|---:|
${fileRows.join('\n')}

## 10. ソースコード全文

${codeAppendix}
`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, doc, 'utf8');
console.log(outputPath);
