/**
 * 実見積データ（kanazawa.xlsx）から複数パターンのリーフ画像を生成する
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'leaf-render-out', 'samples');
fs.mkdirSync(outDir, { recursive: true });

// ─── 1. セル値抽出（xlsx-cells のロジックを移植） ─────────────────────────────
const ALIASES = {
  no:           ['No.','No','NO','NO.','ＮＯ','№','No．','番号'],
  maker_name:   ['メーカー','メーカー名','Maker'],
  product_name: ['品名','商品名','品　名'],
  spec:         ['規格','規　格','Spec'],
  irisu:        ['入数','入　数','入れ数'],
  min_lot:      ['最小ロット','最小ﾛｯﾄ','最小lot','ﾐﾆﾏﾑﾛｯﾄ'],
  retail_price: ['上代','上　代','希望小売価格','定価'],
  cost:         ['単価','原価','仕入単価'],
  jan_code:     ['JANコード','JAN','JANｺｰﾄﾞ','EAN','ＪＡＮコード','ＪＡＮｺｰﾄﾞ'],
  shelf_life:   ['賞味期間','賞味期限','消費期限','賞味期間(夏期)','賞味期間（夏期）'],
  sales_period: ['販売期間','取扱期間'],
  note:         ['備考','特記事項'],
};

function norm(s){ return s.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/\s/g,''); }
function matchH(val,key){ return val && ALIASES[key]?.some(a=>norm(val)===norm(a)); }
function circled(s){ const C='①②③④⑤⑥⑦⑧⑨⑩⑪⑫';const i=C.indexOf((s??'').trim());return i>=0?i+1:parseInt(s,10)||null; }
function cellStr(ws,addr){ const c=ws[addr];if(!c)return null;return String(c.v??'').trim()||null; }
function cellNum(ws,addr){ const c=ws[addr];if(!c)return null;if(typeof c.v==='number')return c.v;const p=parseFloat(String(c.v).replace(/,/g,''));return isNaN(p)?null:p; }

function extractProducts(buf){
  const wb = XLSX.read(buf,{type:'buffer'});
  const results = [];
  for(const name of wb.SheetNames){
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref']??'A1:A1');
    // ヘッダー検出
    let headerRow=-1, colMap={};
    for(let r=range.s.r;r<=Math.min(range.e.r,30);r++){
      const cm={};let cnt=0;
      for(let c=range.s.c;c<=range.e.c;c++){
        const v=cellStr(ws,XLSX.utils.encode_cell({r,c}));
        for(const k of Object.keys(ALIASES)) if(matchH(v,k)){cm[k]=c;cnt++;}
      }
      if(cnt>=3){headerRow=r;colMap=cm;break;}
    }
    if(headerRow<0) continue;
    const get=(r,k)=>{ const c=colMap[k];return c!=null?cellStr(ws,XLSX.utils.encode_cell({r,c})):null; };
    const getN=(r,k)=>{ const c=colMap[k];return c!=null?cellNum(ws,XLSX.utils.encode_cell({r,c})):null; };
    for(let r=headerRow+1;r<=range.e.r;r++){
      // 商品画像セクションで終了
      for(let c=range.s.c;c<=Math.min(range.e.c,20);c++){
        const v=cellStr(ws,XLSX.utils.encode_cell({r,c}));
        if(v&&v.includes('商品画像')) goto_end=true;
      }
      if(goto_end) break;
      const pn=get(r,'product_name');if(!pn) continue;
      // 規格パース
      const specRaw=get(r,'spec')||'';
      const pmatch=specRaw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).match(/(\d+(?:\.\d+)?)個/);
      const gmatch=specRaw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).match(/(\d+(?:\.\d+)?)[gG]/);
      // 入数パース
      const irisuRaw=get(r,'irisu')||'';
      const iparts=irisuRaw.replace(/\s/g,'').split(/[×xX✕×]/u);
      const caseQty=parseInt(iparts[0],10)||0;
      const lotsPerKou=iparts[1]?parseInt(iparts[1],10)||1:1;
      // 最小ロットパース
      const mlRaw=get(r,'min_lot')||'';
      const mlNorm=mlRaw.replace(/\s/g,'');
      const mlNum=parseFloat(mlNorm.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).match(/^(\d+(?:\.\d+)?)/)?.[1]??'1');
      let minLotQty=mlNum;
      if(/甲|こう|コウ/u.test(mlNorm)) minLotQty=mlNum*caseQty*lotsPerKou;
      else if(/ケース|ｹｰｽ|case/ui.test(mlNorm)) minLotQty=mlNum*caseQty;
      // 賞味期限
      const shelfRaw=get(r,'shelf_life')||'';
      const sdm=shelfRaw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).match(/^(\d+)/);
      results.push({
        sheetName:name, no:circled(get(r,'no')),
        maker_name:get(r,'maker_name'), product_name:pn,
        spec_pieces:pmatch?parseInt(pmatch[1],10):null,
        spec_grams:gmatch?parseFloat(gmatch[1]):null,
        case_qty:caseQty, lots_per_kou:lotsPerKou,
        min_lot_qty:Math.round(minLotQty)||1,
        retail_price:getN(r,'retail_price'), cost:getN(r,'cost'),
        shelf_life_days:sdm?parseInt(sdm[1],10):null,
      });
    }
    var goto_end=false;
  }
  return results;
}

// ─── 2. 画像抽出 ─────────────────────────────────────────────────────────────
async function extractImages(buf){
  const zip = await JSZip.loadAsync(buf);
  const result = new Map(); // "sheetName|no" -> buffer

  // drawing→sheet対応
  const wb = await zip.files['xl/workbook.xml']?.async('text')||'';
  const wbRels = await zip.files['xl/_rels/workbook.xml.rels']?.async('text')||'';
  const ridT = new Map([...wbRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],m[2]]));
  const drawToSheet = new Map();
  for(const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)){
    const sf=ridT.get(m[2])?.split('/').pop();
    const sr=await zip.files[`xl/worksheets/_rels/${sf}.rels`]?.async('text')||'';
    const dm=sr.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
    if(dm) drawToSheet.set(dm[1].split('/').pop(), m[1]);
  }

  for(const dp of Object.keys(zip.files).filter(f=>/^xl\/drawings\/drawing\d+\.xml$/.test(f))){
    const xml=await zip.files[dp].async('text');
    const dname=dp.split('/').pop();
    const sheet=drawToSheet.get(dname)||null;
    const rels=await zip.files[`xl/drawings/_rels/${dname}.rels`]?.async('text')||'';
    const rid2m=new Map([...rels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],require_path(dp,m[2])]));
    const anchors=[];
    for(const blk of xml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)){
      const f=blk[0].match(/<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const e=blk[0].match(/r:embed="(rId\d+)"/);
      if(f&&e) anchors.push({col:+f[1],row:+f[2],media:rid2m.get(e[1])});
    }
    const area=anchors.filter(a=>a.row>=20&&zip.files[a.media]);
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
function require_path(drawingPath,target){ return (drawingPath.split('/').slice(0,-1).join('/')+'/'+target).replace(/\/[^\/]+\/\.\./g,'').replace(/^\/+/,''); }

// ─── 3. 計算エンジン ──────────────────────────────────────────────────────────
const S={profitCoef:1.25,salesAdd:3000,unitPriceCap:1000,costCap:33000,halfBase:16500,shelfMinDays:90};
function size(lotPrice,lotQty){
  if(!lotPrice||!lotQty) return{ok:false,leafQty:0,wholesale:0,unitPrice:0,isHalfOk:false,costTotal:0,minLotPrice:lotPrice};
  if(lotPrice>S.costCap) return{ok:false,reason:'cost_over',leafQty:0,wholesale:0,unitPrice:0,isHalfOk:false,costTotal:0,minLotPrice:lotPrice};
  const mx=Math.floor(S.costCap/lotPrice);
  const lq=mx*lotQty, ct=lotPrice*mx;
  const ws=(ct+S.salesAdd)*S.profitCoef, up=ws/lq;
  return{ok:true,leafQty:lq,costTotal:ct,wholesale:ws,unitPrice:up,isHalfOk:lotPrice<=S.halfBase,minLotPrice:lotPrice};
}
function planSingle(p){ return size(p.cost*p.min_lot_qty, p.min_lot_qty); }
function planAssort(ps){
  const lp=ps.reduce((a,p)=>a+p.cost*p.min_lot_qty,0);
  const lq=ps.reduce((a,p)=>a+p.min_lot_qty,0);
  const res=size(lp,lq);
  // アソート専用: 単価 × アイテム数 > 1000円 → NG
  if(res.ok && res.unitPrice*ps.length>1000){res.ok=false;res.reason='assort_unit_price_over';}
  return{...res,itemCount:ps.length};
}

// ─── 4. テンプレート ──────────────────────────────────────────────────────────
const tpl=fs.readFileSync(path.join(root,'lib/leaf/image-template.html'),'utf8');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt=n=>Math.round(n).toLocaleString('ja-JP');
function sizeMm(d){ if(!d)return'—';const s=String(d).replace(/[WＷ]/g,'').replace(/[DＤHＨ]/g,'×').replace(/×+/g,'×').replace(/^×|×$/g,'');return /[a-zA-Z]/.test(s)?s:`${s}mm`;}

function selectTheme(name,note=''){
  const t=`${name} ${note}`;
  if(/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|最中|まんじゅう|饅頭|どら焼|団子|大福|あられ|おかき|かりんとう|せんべい|煎餅|わらび|金澤|金沢/.test(t)) return{cls:'theme-wagashi',label:'和菓子'};
  if(/ポップコーン|スナック|ポテト|チップ|コーン|スティック|ナッツ|豆菓子|揚げ|しお味|塩味|うす塩|コンソメ/.test(t)) return{cls:'theme-snack',label:'スナック'};
  if(/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|フィナンシェ|マドレーヌ|パイ|タルト|ドーナツ|カステラ|ワッフル|ラスク|キャンディ|飴|グミ|マシュマロ/.test(t)) return{cls:'theme-sweets',label:'スイーツ'};
  if(/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|サイダー|ラムネ|ミント|乳酸|シャーベット|アイス/.test(t)) return{cls:'theme-cool',label:'さっぱり'};
  if(/マンゴー|ゼリー|果|フルーツ|桃|みかん|オレンジ|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|林檎|梨|メロン|パイン|キウイ|さくらんぼ|ベリー|柑橘|ピーチ/.test(t)) return{cls:'theme-fruit',label:'フルーツ'};
  return{cls:'theme-standard',label:'おすすめ'};
}

function buildHtml(d){
  const theme=selectTheme(d.leafName);
  const isAssort=d.images.length>1;
  const hero=isAssort
    ?`<div class="assort-grid">${d.images.slice(0,4).map(s=>`<img src="${esc(s)}" alt="" />`).join('')}</div>`
    :`<img class="hero-image" src="${esc(d.images[0]??'')}" alt="" />`;
  const sub=d.images[0]?`<img src="${esc(d.images[0])}" alt="" />`:'<div style="width:100%;height:100%;background:#f5f5f5;border-radius:8px"></div>';
  return tpl
    .replaceAll('{{FONT_URL}}','')
    .replaceAll('{{THEME_CLASS}}',theme.cls)
    .replaceAll('{{THEME_LABEL}}',esc(theme.label))
    .replaceAll('{{MAIN_COPY}}',esc(d.mainCopy))
    .replaceAll('{{SALES_COPY}}',esc(d.salesCopy))
    .replaceAll('{{ASSORT_CLASS}}',isAssort?'assort':'')
    .replaceAll('{{HERO_IMAGE_HTML}}',hero)
    .replaceAll('{{SUB_IMAGE_HTML}}',sub)
    .replaceAll('{{DRAFT_CLASS}}','')
    .replaceAll('{{STATUS_LABEL}}','仮リーフ')
    .replaceAll('{{STATUS_NOTE}}','コード入力前')
    .replaceAll('{{PRODUCT_CODE}}',esc(d.productCode||'（コード未入力）'))
    .replaceAll('{{LEAF_NAME}}',esc(d.leafName))
    .replaceAll('{{ITEM_COUNT}}',fmt(d.itemCount))
    .replaceAll('{{LEAF_QTY}}',fmt(d.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}',fmt(d.wholesale))
    .replaceAll('{{UNIT_PRICE}}',fmt(d.unitPrice))
    .replaceAll('{{PIECE_SIZE}}',esc(sizeMm(d.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}',d.shelfDays?fmt(d.shelfDays):'—')
    .replaceAll('{{LEAD_TIME}}',esc(d.leadTime||'受注後約1週間'))
    .replaceAll('{{HALF_LABEL}}',d.isHalfOk?'可':'不可')
    .replaceAll('{{PJ_NO}}',esc(d.pjNo||'（未入力）'));
}

// ─── 5. 実行 ─────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(path.join(root,'tests/fixtures/real/kanazawa.xlsx'));
const products = extractProducts(buf);
const imgMap = await extractImages(buf);

// piece_size は CSV から補完（XLSX セルには無い → 画像エリアから取ってる）
// 実データで確認済みの値をここでは直接使う
const PIECE_SIZES = {
  1:'W170×D62×H240', 2:'W255×D195×H60', 3:'W295×D160×H60',
  4:'W295×D160×H60', 5:'W295×D160×H60', 6:'W200×D315×H60',
  7:'W200×D315×H60', 8:'W200×D315×H60', 9:'W233×D330×H70',
  10:'W233×D330×H70',11:'W233×D330×H70',12:'W235×D386×H64',
};

function getImg(sheetName, no){ return imgMap.get(`${sheetName}|${no}`)||''; }
function getProd(no){ return products.find(p=>p.no===no); }

const browser = await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});

async function render(filename, data){
  const page = await browser.newPage();
  await page.setViewport({width:1540,height:970,deviceScaleFactor:1});
  await page.setContent(buildHtml(data),{waitUntil:'load'});
  await page.evaluateHandle('document.fonts.ready');
  const out = path.join(outDir, filename);
  await page.screenshot({path:out,type:'png'});
  await page.close();
  console.log('✓', filename);
  return out;
}

const sheet = '御見積書_01';

// ── サンプル① No.1 単品（塩レモンゼリー・フルーツテーマ）
const p1 = getProd(1);
const s1 = planSingle(p1);
await render('01_single_塩レモンゼリー.png', {
  leafName: p1.product_name, itemCount:1,
  leafQty:s1.leafQty, wholesale:s1.wholesale, unitPrice:s1.unitPrice,
  isHalfOk:s1.isHalfOk, shelfDays:p1.shelf_life_days, pieceSize:PIECE_SIZES[1],
  images:[getImg(sheet,1)],
  mainCopy:'さっぱり楽しめる、季節感のあるゼリーギフトです！',
  salesCopy:'爽やかな塩レモン味で\n食べやすいゼリーギフトです。\n景品として案内しやすい商品です。',
  leadTime:'受注後約1週間', pjNo:'（未入力）', productCode:null,
});

// ── サンプル② No.2 単品（水羊羹・和菓子テーマ）
const p2 = getProd(2);
const s2 = planSingle(p2);
await render('02_single_水羊羹.png', {
  leafName: p2.product_name, itemCount:1,
  leafQty:s2.leafQty, wholesale:s2.wholesale, unitPrice:s2.unitPrice,
  isHalfOk:s2.isHalfOk, shelfDays:p2.shelf_life_days, pieceSize:PIECE_SIZES[2],
  images:[getImg(sheet,2)],
  mainCopy:'上品な甘さが楽しめる、\n本格和菓子ギフトです！',
  salesCopy:'贈り物にも喜ばれる\n本格水羊羹ギフト。\n幅広い層に案内しやすい商品です。',
  leadTime:'受注後約1週間', pjNo:'（未入力）', productCode:null,
});

// ── サンプル③ No6+No7 アソート（熟果ゼリー＆マンゴープリン）
const p6=getProd(6), p7=getProd(7);
const sA = planAssort([p6,p7]);
await render('03_assort_熟果ゼリー_マンゴープリン.png', {
  leafName:`${p6.product_name}・${p7.product_name}`, itemCount:2,
  leafQty:sA.leafQty, wholesale:sA.wholesale, unitPrice:sA.unitPrice,
  isHalfOk:sA.isHalfOk, shelfDays:p6.shelf_life_days, pieceSize:PIECE_SIZES[6],
  images:[getImg(sheet,6), getImg(sheet,7)],
  mainCopy:'2種類のフルーツゼリーが同時に楽しめる、\nアソート企画です！',
  salesCopy:'熟果ゼリーと\nマンゴープリンの\n2種アソートです。',
  leadTime:'受注後約1週間', pjNo:'（未入力）', productCode:null,
});

// ── サンプル④ No10+No11 アソート（珈琲ゼリー＆フルーツ水羊羹）
const p10=getProd(10), p11=getProd(11);
const sB = planAssort([p10,p11]);
await render('04_assort_珈琲ゼリー_フルーツ水羊羹.png', {
  leafName:`${p10.product_name}・${p11.product_name}`, itemCount:2,
  leafQty:sB.leafQty, wholesale:sB.wholesale, unitPrice:sB.unitPrice,
  isHalfOk:sB.isHalfOk, shelfDays:p10.shelf_life_days, pieceSize:PIECE_SIZES[10],
  images:[getImg(sheet,10), getImg(sheet,11)],
  mainCopy:'珈琲ゼリーとフルーツ水羊羹の\n上品な2種アソートです！',
  salesCopy:'デザート感覚で楽しめる\n珈琲ゼリーと\n爽やかなフルーツ水羊羹の\n2種セットです。',
  leadTime:'受注後約1週間', pjNo:'（未入力）', productCode:null,
});

// ── サンプル⑤ No9+No10+No11+No12 4種アソート（大型）
const p9=getProd(9), p12=getProd(12);
const sC = planAssort([p9,p10,p11,p12]);
await render('05_assort_4種_ヨーグルト_珈琲_フルーツ_熟果.png', {
  leafName:`ヨーグルト・珈琲・フルーツ・熟果 4種アソート`, itemCount:4,
  leafQty:sC.leafQty, wholesale:sC.wholesale, unitPrice:sC.unitPrice,
  isHalfOk:sC.isHalfOk, shelfDays:180, pieceSize:PIECE_SIZES[9],
  images:[getImg(sheet,9),getImg(sheet,10),getImg(sheet,11),getImg(sheet,12)],
  mainCopy:'4種類の贅沢ギフトが同時に楽しめる、\nアソート企画です！',
  salesCopy:'ヨーグルトムース・珈琲ゼリー・\nフルーツ水羊羹・熟果ゼリーの\n4種アソートです。',
  leadTime:'受注後約1週間', pjNo:'（未入力）', productCode:null,
});

await browser.close();
console.log('\n完了:', outDir);
