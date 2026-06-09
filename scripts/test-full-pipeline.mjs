/**
 * OCR → サイジング → リーフ画像生成 の全パイプラインテスト
 * 指定XLSXを取り込んで各シートの結果と画像を出力する
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import JSZip from 'jszip';
import puppeteer from 'puppeteer';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dir, '..');
const FILE = process.argv[2] || 'tests/fixtures/real/hokushin2.xlsx';
const outDir = path.join(root, 'leaf-render-out', 'pipeline-test');
fs.mkdirSync(outDir, { recursive: true });

// ─── 設定 ────────────────────────────────────────────────────────────────────
const S = { unitPriceCap: 1000, costCap: 33000, halfBase: 16500 };

// ─── ヘルパー ─────────────────────────────────────────────────────────────────
const ALIASES = {
  no:           ['No.','No','NO','NO.','ＮＯ','№','No．','番号'],
  maker_name:   ['メーカー','メーカー名'],
  product_name: ['品名','商品名','品　名'],
  spec:         ['規格','規　格'],
  irisu:        ['入数','入　数','入れ数'],
  min_lot:      ['最小ロット','最小ﾛｯﾄ'],
  retail_price: ['上代','上　代','希望小売価格','定価'],
  cost:         ['単価','原価','仕入単価'],
  jan_code:     ['JANコード','JAN','JANｺｰﾄﾞ','EAN','ＪＡＮコード'],
  shelf_life:   ['賞味期間','賞味期限','消費期限','賞味期間(夏期)','賞味期間（夏期）'],
  sales_period: ['販売期間','取扱期間'],
};
const nrm = s => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/\s/g,'');
const mH = (v,k) => v && ALIASES[k]?.some(a => nrm(v)===nrm(a));
const cStr = (ws,a) => { const c=ws[a]; return c ? String(c.v??'').trim()||null : null; };
const cNum = (ws,a) => { const c=ws[a]; if(!c)return null; if(typeof c.v==='number')return c.v; const p=parseFloat(String(c.v).replace(/,/g,'')); return isNaN(p)?null:p; };
const circ = s => { const C='①②③④⑤⑥⑦⑧⑨⑩⑪⑫'; const i=C.indexOf((s??'').trim()); return i>=0?i+1:parseInt(s,10)||null; };
const ceil100 = n => Math.ceil(n/100)*100;
function gcd(a,b){ return b===0?a:gcd(b,a%b); }
function lcm(a,b){ if(a<=0||b<=0)return Math.max(a,b,1); return (a/gcd(a,b))*b; }
const esc = v => String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt = n => Math.round(n).toLocaleString('ja-JP');
const sizeMm = d => { if(!d)return'—'; const s=String(d).replace(/[WＷ]/g,'').replace(/[DＤHＨ]/g,'×').replace(/×+/g,'×').replace(/^×|×$/g,''); return /[a-zA-Z]/.test(s)?s:`${s}mm`; };

// ─── OCR（セル値抽出） ─────────────────────────────────────────────────────────
function extractSheet(ws, sheetName) {
  const range = XLSX.utils.decode_range(ws['!ref']??'A1:A1');
  let headerRow=-1, colMap={};
  for(let r=range.s.r; r<=Math.min(range.e.r,30); r++){
    const cm={}; let cnt=0;
    for(let c=range.s.c; c<=range.e.c; c++){
      const v=cStr(ws, XLSX.utils.encode_cell({r,c}));
      for(const k of Object.keys(ALIASES)) if(mH(v,k)){cm[k]=c;cnt++;}
    }
    if(cnt>=3){headerRow=r;colMap=cm;break;}
  }
  if(headerRow<0) return {sheetName, products:[], makerName:null};

  const products=[], get=(r,k)=>{ const c=colMap[k]; return c!=null?cStr(ws,XLSX.utils.encode_cell({r,c})):null; };
  const getN=(r,k)=>{ const c=colMap[k]; return c!=null?cNum(ws,XLSX.utils.encode_cell({r,c})):null; };
  let makerName=null;

  for(let r=headerRow+1; r<=range.e.r; r++){
    // 商品画像セクションで終了
    let stop=false;
    for(let c=range.s.c; c<=Math.min(range.e.c,20); c++){
      const v=cStr(ws,XLSX.utils.encode_cell({r,c}));
      if(v&&v.includes('商品画像')){ stop=true; break; }
    }
    if(stop) break;
    const pn=get(r,'product_name'); if(!pn) continue;

    // パーサ群
    const specRaw=get(r,'spec')||'';
    const sn = s => s.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0));
    const pm=sn(specRaw).match(/(\d+(?:\.\d+)?)個/), gm=sn(specRaw).match(/(\d+(?:\.\d+)?)[gG]/);
    const ir=get(r,'irisu')||''; const ip=ir.replace(/\s/g,'').split(/[×xX✕×]/u);
    const caseQty=parseInt(ip[0],10)||0, lotsPerKou=ip[1]?parseInt(ip[1],10)||1:1;
    const ml=get(r,'min_lot')||''; const mln=ml.replace(/\s/g,'');
    const mnum=parseFloat(sn(mln).match(/^(\d+(?:\.\d+)?)/)?.[1]??'1');
    let minLotQty=mnum;
    if(/甲|こう|コウ/u.test(mln)) minLotQty=mnum*caseQty*lotsPerKou;
    else if(/ケース|ｹｰｽ|case/ui.test(mln)) minLotQty=mnum*caseQty;
    const shelfRaw=get(r,'shelf_life')||'';
    const sd=sn(shelfRaw).match(/^(\d+)/);
    const mk=get(r,'maker_name'); if(mk&&!makerName) makerName=mk;

    products.push({
      no:circ(get(r,'no')), sheetName, makerName:mk||makerName,
      product_name:pn, spec_pieces:pm?parseInt(pm[1],10):null,
      spec_grams:gm?parseFloat(gm[1]):null,
      case_qty:caseQty, lots_per_kou:lotsPerKou,
      min_lot_qty:Math.round(minLotQty)||1,
      retail_price:getN(r,'retail_price'), cost:getN(r,'cost'),
      shelf_life_days:sd?parseInt(sd[1],10):null,
    });
  }
  return {sheetName, makerName, products};
}

// ─── サイジング v2 ─────────────────────────────────────────────────────────────
function sizeSets(types) {
  const setCost = types.reduce((a,t)=>a+t.cost*t.ratio,0);
  const setBoxes = types.reduce((a,t)=>a+t.ratio,0);
  if(setCost<=0||setBoxes<=0) return {ok:false,reason:'no_cost',unitPrice:0,leafQty:0,costTotal:0,isHalfOk:false};
  if(setCost>S.unitPriceCap) return {ok:false,reason:'unit_over',unitPrice:setCost,leafQty:0,costTotal:0,isHalfOk:false};
  let step=1;
  for(const t of types){ const per=t.ratio>0?Math.ceil(t.minLotQty/t.ratio):t.minLotQty; step=lcm(step,Math.max(per,1)); }
  const lotPrice=setCost*step;
  if(lotPrice>S.costCap) return {ok:false,reason:'cost_over',unitPrice:setCost,leafQty:0,costTotal:0,isHalfOk:false};
  const maxSets=Math.floor(S.costCap/setCost);
  const sets=Math.floor(maxSets/step)*step;
  if(sets<step) return {ok:false,reason:'cost_over',unitPrice:setCost,leafQty:0,costTotal:0,isHalfOk:false};
  // 掲載値: 単価=1商品あたり原価, 入数=総箱数(sets×種類数)
  const unitPrice = setCost / setBoxes;
  const leafQty = sets * setBoxes;
  const costTotal = ceil100(unitPrice * leafQty);
  return {ok:true,setCost,sets,unitPrice,leafQty,costTotal,isHalfOk:lotPrice<=S.halfBase,maxLots:sets/step};
}

// ─── グルーピング ──────────────────────────────────────────────────────────────
function groupProducts(products) {
  const map = new Map();
  for(const p of products){
    if(!p.makerName||(p.spec_pieces===null&&p.spec_grams===null)||!p.case_qty||p.retail_price===null){
      map.set(`single:${p.no}`, [p]); continue;
    }
    const spec = p.spec_pieces!==null?`p:${p.spec_pieces}`:`g:${p.spec_grams}`;
    const key = `${p.makerName}|${spec}|${p.case_qty*p.lots_per_kou}|${p.retail_price}`;
    const arr = map.get(key)||[]; arr.push(p); map.set(key,arr);
  }
  return [...map.values()].map(arr=>({products:arr, isSingle:arr.length===1}));
}

// アソート候補を「原価合計が単価上限(1000)に収まる」チャンクに貪欲分割する。
// k個の組み合わせを列挙
function combinations(arr, k) {
  if (k <= 0) return [[]];
  if (k > arr.length) return [];
  const res = [];
  const rec = (start, cur) => {
    if (cur.length === k) { res.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return res;
}

// アソート企画を生成する。
// 単価合計(≤1000)と最小ロット原価(≤33,000)の両方を満たす最大の種類数 k を求め、
// k種の組み合わせを企画化する（k=全種ならそのまま1案、未満なら C(n,k) を提案）。
// 組み合わせが多すぎる場合（>MAX）は重複なしのチャンク分割にフォールバック。
const MAX_COMBOS = 6;
function planAssortCombos(products) {
  const sorted = [...products].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
  let bestK = 0;
  for (let k = products.length; k >= 2; k--) {
    const subset = sorted.slice(0, k); // k個の最安サブセットで成立性チェック
    const sz = sizeSets(subset.map(p => ({ cost: p.cost ?? 0, minLotQty: p.min_lot_qty ?? 1, ratio: 1 })));
    if (sz.ok) { bestK = k; break; }
  }
  if (bestK === 0) return [];                 // 2種すら無理 → 単品扱い
  if (bestK >= products.length) return [products]; // 全種で1アソート
  const combos = combinations(products, bestK);
  if (combos.length <= MAX_COMBOS) return combos;   // 全組み合わせを提案
  // 多すぎる場合は重複なしチャンク（各商品1回ずつ）にフォールバック
  const chunks = [];
  for (let i = 0; i < products.length; i += bestK) chunks.push(products.slice(i, i + bestK));
  return chunks.filter(c => c.length >= 2);
}

// ─── 画像抽出 ─────────────────────────────────────────────────────────────────
async function extractImages(buf) {
  const zip = await JSZip.loadAsync(buf);
  const result = new Map();
  const wb2 = await zip.files['xl/workbook.xml']?.async('text')||'';
  const wr = await zip.files['xl/_rels/workbook.xml.rels']?.async('text')||'';
  const ridT = new Map([...wr.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],m[2]]));
  const d2s = new Map();
  for(const m of wb2.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)){
    const sf=ridT.get(m[2])?.split('/').pop();
    const sr=await zip.files[`xl/worksheets/_rels/${sf}.rels`]?.async('text')||'';
    const dm=sr.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
    if(dm) d2s.set(dm[1].split('/').pop(), m[1]);
  }
  for(const dp of Object.keys(zip.files).filter(f=>/^xl\/drawings\/drawing\d+\.xml$/.test(f))){
    const xml=await zip.files[dp].async('text');
    const dn=dp.split('/').pop(); const sheet=d2s.get(dn)||null;
    const rels=await zip.files[`xl/drawings/_rels/${dn}.rels`]?.async('text')||'';
    const r2m=new Map([...rels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],path.join('xl/drawings',m[2]).replace(/\\/g,'/')]));
    const anchors=[];
    for(const blk of xml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)){
      const f=blk[0].match(/<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const e=blk[0].match(/r:embed="(rId\d+)"/);
      if(f&&e) anchors.push({col:+f[1],row:+f[2],media:r2m.get(e[1])});
    }
    const area=anchors.filter(a=>a.row>=20&&a.media&&zip.files[a.media]);
    const rows=[...new Set(area.map(a=>a.row))].sort((a,b)=>a-b);
    const cols=[...new Set(area.map(a=>a.col))].sort((a,b)=>a-b);
    for(const a of area){
      const no=rows.indexOf(a.row)*6+cols.indexOf(a.col)+1;
      const data=Buffer.from(await zip.files[a.media].async('arraybuffer'));
      const ext=a.media.split('.').pop()||'jpg';
      result.set(`${sheet}|${no}`,`data:image/${ext==='jpg'?'jpeg':ext};base64,${data.toString('base64')}`);
    }
  }
  return result;
}

// ─── テーマ選択 ───────────────────────────────────────────────────────────────
function theme(name) {
  if(/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|最中|まんじゅう|饅頭|どら焼|団子|大福|あられ|せんべい|煎餅|カステラ|金澤|金沢/.test(name)) return{cls:'theme-wagashi',label:'和菓子'};
  if(/ポップコーン|スナック|ポテト|チップ|コーン|ナッツ|しお味|塩味/.test(name)) return{cls:'theme-snack',label:'スナック'};
  if(/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|ワッフル|ラスク|キャンディ|飴|グミ/.test(name)) return{cls:'theme-sweets',label:'スイーツ'};
  if(/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|ラムネ|ミント|乳酸/.test(name)) return{cls:'theme-cool',label:'さっぱり'};
  if(/マンゴー|ゼリー|フルーツ|果|桃|みかん|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|梨|メロン|キウイ|さくらんぼ/.test(name)) return{cls:'theme-fruit',label:'フルーツ'};
  return{cls:'theme-standard',label:'おすすめ'};
}

// ─── キャッチコピー自動生成（商品名ベース） ──────────────────────────────────
const COPY_CATS = [
  [/ポップコーン/, 'ポップコーン'], [/水羊羹|水ようかん/, '水羊羹'], [/羊羹|ようかん/, '羊羹'],
  [/カステラ/, 'カステラ'], [/バウム/, 'バウムクーヘン'], [/ケーキ/, 'ケーキ'], [/クッキー/, 'クッキー'],
  [/ムース/, 'ムース'], [/プリン/, 'プリン'], [/ゼリー/, 'ゼリー'], [/最中|もなか/, '最中'],
  [/まんじゅう|饅頭/, 'まんじゅう'], [/せんべい|煎餅/, 'せんべい'], [/チョコ|ショコラ/, 'チョコ'], [/グミ/, 'グミ'],
];
const detectCat = n => { for (const [re, l] of COPY_CATS) if (re.test(n)) return l; return '商品'; };
const flavorOf = n => {
  let s = String(n).trim().replace(/^[0-9A-Za-zＡ-Ｚ＿\-－]+[PpＰ]?(?=[ぁ-んァ-ヶ一-龠])/, '');
  s = s.replace(/(ギフト|ｷﾞﾌﾄ|詰合せ|詰め合わせ|セット)$/g, '');
  for (const [re] of COPY_CATS) s = s.replace(new RegExp(`(?:${re.source})$`), '');
  return s.trim();
};
function mainCopy(ps) {
  if (ps.length >= 2) {
    const cats = [...new Set(ps.map(p => detectCat(p.product_name)))];
    const cat = cats.length === 1 && cats[0] !== '商品' ? cats[0] : '味';
    return `${ps.length}種類の${cat}が一度に楽しめる、\nアソート企画です！`;
  }
  const n = ps[0].product_name, cat = detectCat(n), fl = flavorOf(n);
  if (fl && cat !== '商品') return `${fl}の${cat}が楽しめる、\n景品向けの商品です！`;
  return fl ? `${fl}！` : `${n}です！`;
}
function salesCopy(ps) {
  if (ps.length >= 2) {
    const fls = ps.map(p => flavorOf(p.product_name) || p.product_name).filter(Boolean);
    return `${fls.slice(0,4).join('・')}${fls.length>4?' ほか':''}の\n${ps.length}種アソートです。`;
  }
  const fl = flavorOf(ps[0].product_name), cat = detectCat(ps[0].product_name);
  return fl ? `${fl}の${cat}。\n景品向けにおすすめの商品です。` : '景品向けにおすすめの商品です。';
}

// ─── HTML組み立て ─────────────────────────────────────────────────────────────
const tpl = fs.readFileSync(path.join(root,'lib/leaf/image-template.html'),'utf8');
function buildLeaf(d) {
  const t=theme(d.leafName), isA=d.images.length>1;
  const hero=isA?`<div class="assort-grid">${d.images.slice(0,4).map(s=>`<img src="${esc(s)}"/>`).join('')}</div>`:`<img class="hero-image" src="${esc(d.images[0]??'')}" alt=""/>`;
  return tpl
    .replaceAll('{{FONT_URL}}','').replaceAll('{{THEME_CLASS}}',t.cls).replaceAll('{{THEME_LABEL}}',esc(t.label))
    .replaceAll('{{MAIN_COPY}}',esc(d.copy)).replaceAll('{{SALES_COPY}}',esc(d.copy2))
    .replaceAll('{{ASSORT_CLASS}}',isA?'assort':'').replaceAll('{{HERO_IMAGE_HTML}}',hero)
    .replaceAll('{{SUB_IMAGE_HTML}}',`<img src="${esc(d.images[0]??'')}" alt=""/>`)
    .replaceAll('{{DRAFT_CLASS}}','').replaceAll('{{STATUS_LABEL}}','仮リーフ').replaceAll('{{STATUS_NOTE}}','コード入力前')
    .replaceAll('{{PRODUCT_CODE}}',esc(d.code||'（コード未入力）')).replaceAll('{{LEAF_NAME}}',esc(d.leafName))
    .replaceAll('{{ITEM_COUNT}}',fmt(d.itemCount)).replaceAll('{{LEAF_QTY}}',fmt(d.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}',fmt(d.costTotal)).replaceAll('{{UNIT_PRICE}}',fmt(d.unitPrice))
    .replaceAll('{{PIECE_SIZE}}',esc(sizeMm(d.pieceSize))).replaceAll('{{SHELF_LIFE_DAYS}}',d.shelf?fmt(d.shelf):'—')
    .replaceAll('{{LEAD_TIME}}',esc(d.lead||'受注後約1週間')).replaceAll('{{HALF_LABEL}}',d.half?'可':'不可')
    .replaceAll('{{PJ_NO}}',esc(d.pj||'（未入力）'));
}

// ─── メイン ───────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(path.join(root, FILE));
const wb  = XLSX.read(buf, {type:'buffer'});
const imgMap = await extractImages(buf);

const browser = await puppeteer.launch({headless:true, args:['--no-sandbox','--disable-setuid-sandbox']});
const rendered = [];

for(const sheetName of wb.SheetNames){
  const ws = wb.Sheets[sheetName];
  const {products, makerName} = extractSheet(ws, sheetName);
  if(!products.length){ console.log(`[${sheetName}] ⚠️ 商品0件（ヘッダー未検出）`); continue; }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 ${sheetName}  メーカー: ${makerName}  商品: ${products.length}件`);
  console.log('─'.repeat(60));

  // グルーピング → アソート企画を生成（最大k種、超えたらk-1種の組み合わせ）
  const rawGroups = groupProducts(products);
  const groups = rawGroups.flatMap(g => {
    if (g.isSingle || g.products.length <= 1) return [{ products: g.products, isSingle: true }];
    const combos = planAssortCombos(g.products);
    if (combos.length === 0) return g.products.map(p => ({ products: [p], isSingle: true }));
    return combos.map(c => ({ products: c, isSingle: c.length === 1 }));
  });

  const assortN = groups.filter(g => !g.isSingle).length;
  const singleN = groups.filter(g => g.isSingle).length;
  console.log(`グループ: ${groups.length}件（アソート:${assortN}件, 単品:${singleN}件）\n`);

  let singleRendered = 0, assortRendered = 0;
  for (const g of groups) {
    const ps = g.products;
    const types = ps.map(p => ({ cost: p.cost ?? 0, minLotQty: p.min_lot_qty ?? 1, ratio: 1 }));
    const sz = sizeSets(types);
    const tag = g.isSingle ? '単品' : `アソート${ps.length}種`;
    const names = ps.map(p => p.product_name).join('・');
    const sum = ps.reduce((a, p) => a + (p.cost ?? 0), 0);

    if (sz.ok) {
      console.log(`✅ [${tag}] ${names}`);
      console.log(`   No: ${ps.map(p => p.no).join('+')} | 単価: ${fmt(sz.unitPrice)}円 | 入数: ${sz.leafQty}個 | 卸価格: ${fmt(sz.costTotal)}円 | ハーフ: ${sz.isHalfOk ? '可' : '不可'}`);
    } else {
      console.log(`❌ [${tag}] ${names}`);
      console.log(`   → 除外: ${sz.reason} (単価合計 ${sum}円)`);
    }

    // アソートを優先的にレンダリング（各シート アソート最大3枚＋単品最大2枚）
    const wantRender = sz.ok && ((!g.isSingle && assortRendered < 3) || (g.isSingle && singleRendered < 2));
    if (wantRender) {
      const imgs = ps.slice(0, 4).map(p => imgMap.get(`${sheetName}|${p.no}`) || '').filter(Boolean);
      const leafName = ps.map(p => p.product_name).join('・');
      const shelfVals = ps.map(p => p.shelf_life_days ?? 999).filter(x => x < 999);
      const shelf = shelfVals.length ? Math.min(...shelfVals) : null;
      const html = buildLeaf({
        leafName, images: imgs, itemCount: ps.length,
        leafQty: sz.leafQty, costTotal: sz.costTotal, unitPrice: sz.unitPrice,
        isHalfOk: sz.isHalfOk, half: sz.isHalfOk, shelf,
        copy: mainCopy(ps), copy2: salesCopy(ps),
        lead: '受注後約1週間', pj: '（未入力）', pieceSize: null,
      });
      const kind = g.isSingle ? `No${ps[0].no}` : `assort_No${ps.map(p => p.no).join('-')}`;
      const fname = `${sheetName}_${kind}.png`;
      const page = await browser.newPage();
      await page.setViewport({ width: 1540, height: 970, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluateHandle('document.fonts.ready');
      await page.screenshot({ path: path.join(outDir, fname), type: 'png' });
      await page.close();
      rendered.push({ sheet: sheetName, file: fname });
      if (g.isSingle) singleRendered++; else assortRendered++;
    }
  }
}

await browser.close();
console.log(`\n${'═'.repeat(60)}`);
console.log(`🖼️  レンダリング完了: ${rendered.length}枚`);
rendered.forEach(r=>console.log(`   ${r.sheet}: ${r.file}`));
