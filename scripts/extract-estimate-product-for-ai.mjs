import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const inputPath = process.argv[2];
const outDir = process.argv[3] ?? path.join(root, 'leaf-render-out', 'ai-prompt-from-estimate');
const selectedNo = Number(process.argv[4] ?? 1);

if (!inputPath) {
  throw new Error('Usage: node scripts/extract-estimate-product-for-ai.mjs <xlsx> [outDir] [productNo]');
}

fs.mkdirSync(outDir, { recursive: true });

const ALIASES = {
  no: ['No.', 'No', 'NO', 'NO.', 'ＮＯ', '№', '番号'],
  maker_name: ['メーカー', 'メーカー名', 'Maker'],
  product_name: ['品名', '商品名', '品　名'],
  spec: ['規格', '規　格', 'Spec'],
  irisu: ['入数', '入　数', '入れ数'],
  min_lot: ['最小ロット', '最小ﾛｯﾄ', '最小lot', 'ﾐﾆﾏﾑﾛｯﾄ'],
  retail_price: ['上代', '上　代', '希望小売価格', '定価'],
  cost: ['単価', '原価', '仕入単価'],
  shelf_life: ['賞味期間', '賞味期限', '消費期限', '賞味期間(夏期)', '賞味期間（夏期）'],
  sales_period: ['販売期間', '取扱期間'],
  note: ['備考', '特記事項'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s/g, '');
}

function matchHeader(value, key) {
  const normalized = normalizeHeader(value);
  return ALIASES[key]?.some((alias) => normalizeHeader(alias) === normalized) ?? false;
}

function cellString(ws, address) {
  const cell = ws[address];
  if (!cell) return null;
  return String(cell.v ?? '').trim() || null;
}

function cellNumber(ws, address) {
  const cell = ws[address];
  if (!cell) return null;
  if (typeof cell.v === 'number') return cell.v;
  const parsed = Number(String(cell.v).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNo(value) {
  const text = String(value ?? '').trim();
  const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫';
  const idx = circled.indexOf(text);
  if (idx >= 0) return idx + 1;
  const parsed = Number(text.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function detectCategory(name) {
  if (/ポップコーン|スナック|チップ|コーン/.test(name)) return 'スナック';
  if (/羊羹|ようかん|和菓子|金澤|金沢|饅頭|まんじゅう|最中/.test(name)) return '和菓子';
  if (/ゼリー|果|フルーツ|レモン|マンゴー|苺|いちご|メロン|桃|ぶどう|葡萄/.test(name)) return 'フルーツゼリー';
  if (/チョコ|クッキー|ケーキ|バウム|カステラ/.test(name)) return 'スイーツ';
  return '食品景品';
}

function flavorOf(name) {
  return String(name)
    .replace(/^[0-9A-Za-zＡ-Ｚ＿_\-－]+[PpＰ]?/, '')
    .replace(/(ゼリー|水羊羹|羊羹|ギフト|詰合せ|詰め合わせ|セット)$/g, '')
    .trim();
}

function parseMinLotQty(minLot, irisu) {
  const lotText = String(minLot ?? '').replace(/\s/g, '');
  const irisuText = String(irisu ?? '').replace(/[×xX✕]/g, '×');
  const [caseText, kouText] = irisuText.split('×');
  const caseQty = Number(caseText) || 1;
  const lotsPerKou = Number(kouText) || 1;
  const lotNum = Number(lotText.match(/\d+/)?.[0] ?? 1);
  if (/甲/.test(lotText)) return lotNum * caseQty * lotsPerKou;
  if (/ケース|ｹｰｽ|case/i.test(lotText)) return lotNum * caseQty;
  if (/ピース|個/.test(lotText)) return lotNum;
  return lotNum * caseQty;
}

function planSingle(product) {
  const cost = product.cost ?? 0;
  const minLotQty = parseMinLotQty(product.minLot, product.irisu);
  const minLotPrice = cost * minLotQty;
  if (!cost || !minLotQty || minLotPrice > 33000) {
    return {
      leafQty: minLotQty,
      wholesalePrice: 0,
      unitPrice: 0,
      isHalfOk: minLotPrice <= 16500,
    };
  }
  const maxLots = Math.floor(33000 / minLotPrice);
  const leafQty = maxLots * minLotQty;
  const costTotal = cost * leafQty;
  const wholesalePrice = (costTotal + 3000) * 1.25;
  return {
    leafQty,
    wholesalePrice,
    unitPrice: wholesalePrice / leafQty,
    isHalfOk: minLotPrice <= 16500,
  };
}

function extractProducts(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const products = [];

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    let headerRow = -1;
    let colMap = {};

    for (let r = range.s.r; r <= Math.min(range.e.r, 35); r++) {
      const candidate = {};
      let hits = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const value = cellString(ws, XLSX.utils.encode_cell({ r, c }));
        for (const key of Object.keys(ALIASES)) {
          if (matchHeader(value, key)) {
            candidate[key] = c;
            hits += 1;
          }
        }
      }
      if (hits >= 4 && candidate.product_name != null) {
        headerRow = r;
        colMap = candidate;
        break;
      }
    }

    if (headerRow < 0) continue;
    const get = (r, key) =>
      colMap[key] != null ? cellString(ws, XLSX.utils.encode_cell({ r, c: colMap[key] })) : null;
    const getNumber = (r, key) =>
      colMap[key] != null ? cellNumber(ws, XLSX.utils.encode_cell({ r, c: colMap[key] })) : null;

    let emptyStreak = 0;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const productName = get(r, 'product_name');
      if (!productName) {
        emptyStreak += 1;
        if (emptyStreak >= 3 && products.length > 0) break;
        continue;
      }
      emptyStreak = 0;
      products.push({
        sheetName,
        no: parseNo(get(r, 'no')) ?? products.filter((p) => p.sheetName === sheetName).length + 1,
        makerName: get(r, 'maker_name'),
        productName,
        spec: get(r, 'spec'),
        irisu: get(r, 'irisu'),
        minLot: get(r, 'min_lot'),
        retailPrice: getNumber(r, 'retail_price'),
        cost: getNumber(r, 'cost'),
        shelfLife: get(r, 'shelf_life'),
        salesPeriod: get(r, 'sales_period'),
        note: get(r, 'note'),
      });
    }
  }

  return products;
}

function resolveZipPath(base, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
}

async function extractImages(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = (await zip.files['xl/workbook.xml']?.async('text')) ?? '';
  const workbookRels = (await zip.files['xl/_rels/workbook.xml.rels']?.async('text')) ?? '';

  const relToSheetFile = new Map();
  for (const m of workbookRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
    relToSheetFile.set(m[1], path.posix.basename(m[2]));
  }

  const drawingToSheet = new Map();
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const sheetName = m[1];
    const sheetFile = relToSheetFile.get(m[2]);
    if (!sheetFile) continue;
    const relPath = `xl/worksheets/_rels/${sheetFile}.rels`;
    const sheetRels = (await zip.files[relPath]?.async('text')) ?? '';
    const dm = sheetRels.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
    if (dm) drawingToSheet.set(path.posix.basename(dm[1]), sheetName);
  }

  const results = [];
  for (const drawingPath of Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f))) {
    const drawingXml = await zip.files[drawingPath].async('text');
    const drawingName = path.posix.basename(drawingPath);
    const sheetName = drawingToSheet.get(drawingName) ?? null;
    const relsPath = `xl/drawings/_rels/${drawingName}.rels`;
    const relsXml = (await zip.files[relsPath]?.async('text')) ?? '';
    const ridToMedia = new Map();
    for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
      ridToMedia.set(m[1], resolveZipPath(drawingPath, m[2]));
    }

    const anchors = [];
    for (const block of drawingXml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
      const body = block[0];
      const from = body.match(/<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const embed = body.match(/r:embed="(rId\d+)"/);
      if (!from || !embed) continue;
      const mediaPath = ridToMedia.get(embed[1]);
      if (!mediaPath || !zip.files[mediaPath]) continue;
      anchors.push({ col: Number(from[1]), row: Number(from[2]), mediaPath });
    }

    const productAnchors = anchors.filter((a) => a.row >= 20);
    const rows = [...new Set(productAnchors.map((a) => a.row))].sort((a, b) => a - b);
    const cols = [...new Set(productAnchors.map((a) => a.col))].sort((a, b) => a - b);

    for (const anchor of productAnchors) {
      const no = rows.indexOf(anchor.row) * 6 + cols.indexOf(anchor.col) + 1;
      const ext = path.extname(anchor.mediaPath).toLowerCase() || '.jpg';
      const buffer = Buffer.from(await zip.files[anchor.mediaPath].async('arraybuffer'));
      results.push({ sheetName, no, ext, buffer, mediaPath: anchor.mediaPath });
    }
  }

  return results;
}

function buildBackgroundPrompt(product) {
  const category = detectCategory(product.productName);
  const flavor = flavorOf(product.productName);
  return `横長のゲームセンター景品向け販促リーフ背景を作成してください。

商品情報:
- 商品名: ${product.productName}
- メーカー: ${product.makerName ?? '不明'}
- カテゴリ: ${category}
- 味・特徴: ${flavor || product.productName}
- 規格: ${product.spec ?? '不明'}

デザイン条件:
- 横長 1540×838px 相当
- 下部132pxは価格情報を後から重ねるため、重要な装飾を置かない
- 左側45%には実際の商品画像を大きく合成するため、明るくシンプルな余白を残す
- 右上35%にはキャッチコピーを後から載せるため、文字が読みやすい余白を作る
- 商品カテゴリに合う背景にする
- フルーツ・ゼリー系なら、みずみずしさ、爽やかさ、季節感を出す
- 和菓子系なら、上品で落ち着いた和風の雰囲気にする
- スナック系なら、映画館・イベント感のある楽しい雰囲気にする
- 枠、白いカード、吹き出し、UI風の角丸ボックスは作らない
- 商品パッケージ、ロゴ、価格、文字は描かない

出力:
文字なし、商品なしの背景画像のみ。`;
}

function buildFullImagePrompt(product) {
  const category = detectCategory(product.productName);
  const flavor = flavorOf(product.productName);
  const mainCopy =
    category === '和菓子'
      ? `${flavor || product.productName}を上品に楽しめる！`
      : category === 'フルーツゼリー'
        ? `${flavor || product.productName}の爽やかなおいしさ！`
        : `${flavor || product.productName}が楽しめる！`;

  return {
    product,
    sizing: planSingle(product),
    prompt: `添付見積書から取得した商品「${product.productName}」の営業確認用リーフ画像を作成します。
実運用では商品画像は元画像をそのまま合成するため、AI生成では背景と販促トーンだけを作成します。

背景テーマ:
${buildBackgroundPrompt(product)}

キャッチコピー案:
${mainCopy}

合成時の配置:
- 商品画像: 左側に大きく配置
- キャッチコピー: 右上に大きく配置
- 下部: 商品コード、商品名、アイテム数、入数、卸価格、単価、サイズ、賞味期限、納期、ハーフ可否を白帯に表示`,
    mainCopy,
  };
}

const buffer = fs.readFileSync(inputPath);
const products = extractProducts(buffer);
const images = await extractImages(buffer);

const target =
  products.find((p) => p.no === selectedNo && images.some((img) => img.sheetName === p.sheetName && img.no === p.no)) ??
  products.find((p) => images.some((img) => img.sheetName === p.sheetName && img.no === p.no));

if (!target) throw new Error('商品画像に対応する商品が見つかりませんでした。');

const image = images.find((img) => img.sheetName === target.sheetName && img.no === target.no);
if (!image) throw new Error('対象商品の画像が見つかりませんでした。');

const imageName = `product_${target.sheetName ?? 'sheet'}_${String(target.no).padStart(2, '0')}${image.ext}`;
const imagePath = path.join(outDir, imageName);
fs.writeFileSync(imagePath, image.buffer);

const payload = buildFullImagePrompt(target);
const promptPath = path.join(outDir, 'generated_prompt.txt');
const jsonPath = path.join(outDir, 'product_payload.json');
fs.writeFileSync(promptPath, payload.prompt, 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify({ ...payload, imagePath }, null, 2), 'utf8');

console.log(JSON.stringify({ product: target, imagePath, promptPath, jsonPath, prompt: payload.prompt }, null, 2));
