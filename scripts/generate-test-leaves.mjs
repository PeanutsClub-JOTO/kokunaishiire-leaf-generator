/**
 * 新テンプレートでのリーフ画像生成テスト
 * 実際の kanazawa.xlsx から商品データ・画像を取得して生成する
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'leaf-render-out', 'new-template-test');
fs.mkdirSync(outDir, { recursive: true });

// ─── ユーティリティ ────────────────────────────────────────────────────────────
const esc = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmt = n => Math.round(n).toLocaleString('ja-JP');

// ─── XLSX セル抽出 ─────────────────────────────────────────────────────────────
const ALIASES = {
  no:           ['No.','No','NO','NO.','ＮＯ','№','No．','番号'],
  product_name: ['品名','商品名','品　名'],
  irisu:        ['入数','入　数','入れ数'],
  min_lot:      ['最小ロット','最小ﾛｯﾄ'],
  cost:         ['単価','原価','仕入単価'],
  shelf_life:   ['賞味期間','賞味期限','消費期限'],
};
const norm = s => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\s/g,'');
const matchH = (val, key) => val && ALIASES[key]?.some(a => norm(val) === norm(a));
const circled = s => { const C='①②③④⑤⑥⑦⑧⑨⑩⑪⑫'; const i=C.indexOf((s??'').trim()); return i>=0?i+1:parseInt(s,10)||null; };
const cellStr = (ws,addr) => { const c=ws[addr]; if(!c)return null; return String(c.v??'').trim()||null; };
const cellNum = (ws,addr) => { const c=ws[addr]; if(!c)return null; if(typeof c.v==='number')return c.v; const p=parseFloat(String(c.v).replace(/,/g,'')); return isNaN(p)?null:p; };

function extractProducts(buf) {
  const wb = XLSX.read(buf, {type:'buffer'});
  const results = [];
  for(const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    let headerRow = -1, colMap = {};
    for(let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
      const cm = {}; let cnt = 0;
      for(let c = range.s.c; c <= range.e.c; c++) {
        const v = cellStr(ws, XLSX.utils.encode_cell({r,c}));
        for(const k of Object.keys(ALIASES)) if(matchH(v,k)){cm[k]=c;cnt++;}
      }
      if(cnt >= 3){headerRow=r;colMap=cm;break;}
    }
    if(headerRow < 0) continue;
    const get = (r,k) => { const c=colMap[k]; return c!=null?cellStr(ws,XLSX.utils.encode_cell({r,c})):null; };
    const getN = (r,k) => { const c=colMap[k]; return c!=null?cellNum(ws,XLSX.utils.encode_cell({r,c})):null; };
    let goto_end = false;
    for(let r = headerRow+1; r <= range.e.r; r++) {
      for(let c = range.s.c; c <= Math.min(range.e.c,20); c++) {
        const v = cellStr(ws, XLSX.utils.encode_cell({r,c}));
        if(v && v.includes('商品画像')) goto_end = true;
      }
      if(goto_end) break;
      const pn = get(r,'product_name'); if(!pn) continue;
      const irisuRaw = get(r,'irisu') || '';
      const iparts = irisuRaw.replace(/\s/g,'').split(/[×xX✕×]/u);
      const caseQty = parseInt(iparts[0],10)||0;
      const lotsPerKou = iparts[1]?parseInt(iparts[1],10)||1:1;
      const mlRaw = get(r,'min_lot') || '';
      const mlNorm = mlRaw.replace(/\s/g,'');
      const mlNum = parseFloat(mlNorm.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).match(/^(\d+(?:\.\d+)?)/)?.[1]??'1');
      let minLotQty = mlNum;
      if(/甲|こう|コウ/u.test(mlNorm)) minLotQty = mlNum*caseQty*lotsPerKou;
      else if(/ケース|ｹｰｽ|case/ui.test(mlNorm)) minLotQty = mlNum*caseQty;
      const shelfRaw = get(r,'shelf_life') || '';
      const sdm = shelfRaw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).match(/^(\d+)/);
      results.push({
        sheetName: name, no: circled(get(r,'no')),
        product_name: pn, case_qty: caseQty, lots_per_kou: lotsPerKou,
        min_lot_qty: Math.round(minLotQty)||1,
        cost: getN(r,'cost'),
        shelf_life_days: sdm?parseInt(sdm[1],10):null,
      });
    }
  }
  return results;
}

// ─── 画像抽出 ──────────────────────────────────────────────────────────────────
function resolvePath(drawingPath, target) {
  return (drawingPath.split('/').slice(0,-1).join('/') + '/' + target)
    .replace(/\/[^/]+\/\.\./g,'').replace(/^\/+/,'');
}

async function extractImages(buf) {
  const zip = await JSZip.loadAsync(buf);
  const result = new Map();
  const wb = await zip.files['xl/workbook.xml']?.async('text') || '';
  const wbRels = await zip.files['xl/_rels/workbook.xml.rels']?.async('text') || '';
  const ridT = new Map([...wbRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],m[2]]));
  const drawToSheet = new Map();
  for(const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const sf = ridT.get(m[2])?.split('/').pop();
    const sr = await zip.files[`xl/worksheets/_rels/${sf}.rels`]?.async('text') || '';
    const dm = sr.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
    if(dm) drawToSheet.set(dm[1].split('/').pop(), m[1]);
  }
  for(const dp of Object.keys(zip.files).filter(f=>/^xl\/drawings\/drawing\d+\.xml$/.test(f))) {
    const xml = await zip.files[dp].async('text');
    const dname = dp.split('/').pop();
    const sheet = drawToSheet.get(dname) || null;
    const rels = await zip.files[`xl/drawings/_rels/${dname}.rels`]?.async('text') || '';
    const rid2m = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],resolvePath(dp,m[2])]));
    const anchors = [];
    for(const blk of xml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
      const f = blk[0].match(/<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const e = blk[0].match(/r:embed="(rId\d+)"/);
      if(f&&e) anchors.push({col:+f[1],row:+f[2],media:rid2m.get(e[1])});
    }
    const area = anchors.filter(a=>a.row>=20 && zip.files[a.media]);
    const rows = [...new Set(area.map(a=>a.row))].sort((a,b)=>a-b);
    const cols = [...new Set(area.map(a=>a.col))].sort((a,b)=>a-b);
    for(const a of area) {
      const no = rows.indexOf(a.row)*6 + cols.indexOf(a.col) + 1;
      const data = Buffer.from(await zip.files[a.media].async('arraybuffer'));
      const ext = a.media.split('.').pop() || 'jpg';
      result.set(`${sheet}|${no}`, `data:image/${ext==='jpg'?'jpeg':ext};base64,${data.toString('base64')}`);
    }
  }
  return result;
}

// ─── 計算エンジン ──────────────────────────────────────────────────────────────
const S = {profitCoef:1.25, salesAdd:3000, unitPriceCap:1000, costCap:33000, halfBase:16500};
function size(lotPrice, lotQty) {
  if(!lotPrice||!lotQty) return {ok:false,leafQty:0,wholesale:0,unitPrice:0,isHalfOk:false};
  if(lotPrice > S.costCap) return {ok:false,reason:'cost_over',leafQty:0,wholesale:0,unitPrice:0,isHalfOk:false};
  const mx = Math.floor(S.costCap / lotPrice);
  const lq = mx * lotQty, ct = lotPrice * mx;
  const ws = (ct + S.salesAdd) * S.profitCoef, up = ws / lq;
  return {ok:true, leafQty:lq, costTotal:ct, wholesale:ws, unitPrice:up, isHalfOk:lotPrice <= S.halfBase};
}
function planSingle(p) { return size(p.cost * p.min_lot_qty, p.min_lot_qty); }
function planAssort(ps) {
  const lp = ps.reduce((a,p) => a + p.cost * p.min_lot_qty, 0);
  const lq = ps.reduce((a,p) => a + p.min_lot_qty, 0);
  const res = size(lp, lq);
  // アソート専用: 単価 × アイテム数 > 1000円 → NG
  if (res.ok && res.unitPrice * ps.length > 1000) {
    res.ok = false;
    res.reason = 'assort_unit_price_over';
  }
  return {...res, itemCount: ps.length};
}

// ─── テーマ選択 ────────────────────────────────────────────────────────────────
function selectTheme(name) {
  const t = name;
  if(/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|最中|まんじゅう|どら焼|団子|大福|あられ|おかき|かりんとう|せんべい|煎餅|わらび|金澤|金沢/.test(t)) return 'theme-wagashi';
  if(/ポップコーン|スナック|ポテト|チップ|コーン|ナッツ|豆菓子|揚げ/.test(t)) return 'theme-snack';
  if(/チョコ|ショコラ|キャラメル|クッキー|ケーキ|バウム|カステラ|グミ|飴/.test(t)) return 'theme-sweets';
  if(/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|ラムネ|ミント|乳酸|シャーベット|アイス|カルピス/.test(t)) return 'theme-cool';
  if(/マンゴー|ゼリー|果|フルーツ|桃|みかん|オレンジ|ぶどう|マスカット|いちご|苺|りんご|梨|メロン|パイン|キウイ|さくらんぼ|ベリー|柑橘|ピーチ/.test(t)) return 'theme-fruit';
  return 'theme-standard';
}

// ─── 新テンプレートで HTML 組み立て ───────────────────────────────────────────
const tpl = fs.readFileSync(path.join(root, 'lib/leaf/image-template.html'), 'utf8');

function buildProductAreaClass(images) {
  if(images.length <= 1) return 'single';
  if(images.length === 2) return 'assort-2';
  if(images.length === 3) return 'assort-3';
  return 'assort-4';
}

function buildProductImagesHtml(images) {
  const valid = images.filter(Boolean);
  if(valid.length === 0) return '<div class="img-placeholder">商品画像未設定</div>';
  return valid.slice(0, 4).map(src => `<img src="${esc(src)}" alt="商品画像" />`).join('');
}

const PIECE_SIZES = {
  1:'W170×D62×H240', 2:'W255×D195×H60', 3:'W295×D160×H60',
  4:'W295×D160×H60', 5:'W295×D160×H60', 6:'W200×D315×H60',
  7:'W200×D315×H60', 8:'W200×D315×H60', 9:'W233×D330×H70',
  10:'W233×D330×H70',11:'W233×D330×H70',12:'W235×D386×H64',
};
function sizeMm(d) {
  if(!d) return '—';
  const s = String(d).replace(/[WＷ]/g,'').replace(/[DＤHＨ]/g,'×').replace(/×+/g,'×').replace(/^×|×$/g,'');
  return /[a-zA-Z]/.test(s) ? s : `${s}mm`;
}

function buildHtml(d) {
  const themeClass = selectTheme(d.leafName);
  const areaClass = buildProductAreaClass(d.images);
  const imagesHtml = buildProductImagesHtml(d.images);
  return tpl
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{THEME_CLASS}}', themeClass)
    .replaceAll('{{AI_BG_STYLE}}', '')
    .replaceAll('{{MAIN_COPY}}', esc(d.mainCopy))
    .replaceAll('{{PRODUCT_AREA_CLASS}}', areaClass)
    .replaceAll('{{PRODUCT_IMAGES_HTML}}', imagesHtml)
    .replaceAll('{{DRAFT_CLASS}}', '')
    .replaceAll('{{STATUS_LABEL}}', '仮リーフ')
    .replaceAll('{{PRODUCT_CODE}}', esc(d.productCode || '（コード未入力）'))
    .replaceAll('{{LEAF_NAME}}', esc(d.leafName))
    .replaceAll('{{ITEM_COUNT}}', fmt(d.itemCount))
    .replaceAll('{{LEAF_QTY}}', fmt(d.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', fmt(d.wholesale))
    .replaceAll('{{UNIT_PRICE}}', fmt(d.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', esc(sizeMm(d.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', d.shelfDays ? fmt(d.shelfDays) : '—')
    .replaceAll('{{LEAD_TIME}}', esc(d.leadTime || '受注後約1週間'))
    .replaceAll('{{HALF_LABEL}}', d.isHalfOk ? '可' : '不可')
    .replaceAll('{{HALF_NG_CLASS}}', d.isHalfOk ? '' : 'ng')
    .replaceAll('{{PJ_NO}}', esc(d.pjNo || '（未入力）'));
}

// ─── 実行 ──────────────────────────────────────────────────────────────────────
console.log('📂 kanazawa.xlsx 読み込み中...');
const buf = fs.readFileSync(path.join(root, 'tests/fixtures/real/kanazawa.xlsx'));
const products = extractProducts(buf);
const imgMap = await extractImages(buf);
console.log(`✓ 商品数: ${products.length}件, 画像数: ${imgMap.size}枚`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

async function render(filename, data) {
  const page = await browser.newPage();
  await page.setViewport({width: 1540, height: 970, deviceScaleFactor: 2});
  const html = buildHtml(data);
  await page.setContent(html, {waitUntil: 'load'});
  await page.evaluateHandle('document.fonts.ready');
  await page.evaluate(() =>
    Promise.all([...document.querySelectorAll('img')].map(img =>
      img.complete ? Promise.resolve() :
      new Promise(r => { img.addEventListener('load', r); img.addEventListener('error', r); })
    ))
  );
  const out = path.join(outDir, filename);
  await page.screenshot({path: out, type: 'png'});
  await page.close();
  console.log('✓', filename);
}

const sheet = '御見積書_01';
const getImg = (no) => imgMap.get(`${sheet}|${no}`) || '';
const getProd = (no) => products.find(p => p.no === no);

// ① No.1 単品（塩レモンゼリー）
const p1 = getProd(1);
if(p1) {
  const s1 = planSingle(p1);
  await render('01_単品_塩レモンゼリー.png', {
    leafName: p1.product_name, itemCount: 1,
    leafQty: s1.leafQty, wholesale: s1.wholesale, unitPrice: s1.unitPrice,
    isHalfOk: s1.isHalfOk, shelfDays: p1.shelf_life_days, pieceSize: PIECE_SIZES[1],
    images: [getImg(1)],
    mainCopy: 'さっぱり楽しめる、\\n季節感のあるゼリーギフトです！',
    leadTime: '受注後約1週間', pjNo: '（未入力）', productCode: null,
  });
}

// ② No.2 単品（水羊羹）
const p2 = getProd(2);
if(p2) {
  const s2 = planSingle(p2);
  await render('02_単品_水羊羹.png', {
    leafName: p2.product_name, itemCount: 1,
    leafQty: s2.leafQty, wholesale: s2.wholesale, unitPrice: s2.unitPrice,
    isHalfOk: s2.isHalfOk, shelfDays: p2.shelf_life_days, pieceSize: PIECE_SIZES[2],
    images: [getImg(2)],
    mainCopy: '上品な甘さが楽しめる、\\n本格和菓子ギフトです！',
    leadTime: '受注後約1週間', pjNo: '（未入力）', productCode: null,
  });
}

// ③ No.6+7 アソート（熟果ゼリー&マンゴープリン）
const p6 = getProd(6), p7 = getProd(7);
if(p6 && p7) {
  const sA = planAssort([p6, p7]);
  await render('03_アソート2種_熟果ゼリー_マンゴープリン.png', {
    leafName: `${p6.product_name}・${p7.product_name}`, itemCount: 2,
    leafQty: sA.leafQty, wholesale: sA.wholesale, unitPrice: sA.unitPrice,
    isHalfOk: sA.isHalfOk, shelfDays: p6.shelf_life_days, pieceSize: PIECE_SIZES[6],
    images: [getImg(6), getImg(7)],
    mainCopy: '2種類のフルーツゼリーが\\n同時に楽しめるアソートです！',
    leadTime: '受注後約1週間', pjNo: '（未入力）', productCode: null,
  });
}

// ④ No.9+10+11+12 4種アソート
const p9 = getProd(9), p10 = getProd(10), p11 = getProd(11), p12 = getProd(12);
if(p9 && p10 && p11 && p12) {
  const sC = planAssort([p9, p10, p11, p12]);
  await render('04_アソート4種_大型.png', {
    leafName: 'ヨーグルト・珈琲・フルーツ・熟果 4種アソート', itemCount: 4,
    leafQty: sC.leafQty, wholesale: sC.wholesale, unitPrice: sC.unitPrice,
    isHalfOk: sC.isHalfOk, shelfDays: 180, pieceSize: PIECE_SIZES[9],
    images: [getImg(9), getImg(10), getImg(11), getImg(12)],
    mainCopy: '4種類の贅沢ギフトが\\n同時に楽しめるアソートです！',
    leadTime: '受注後約1週間', pjNo: '（未入力）', productCode: null,
  });
}

await browser.close();
console.log('\n✅ 完了:', outDir);
