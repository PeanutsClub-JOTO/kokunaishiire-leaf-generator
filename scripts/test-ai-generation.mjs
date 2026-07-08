/**
 * 新プロンプトでのAI背景生成＋キャッチコピー生成テスト
 * 使い方: node scripts/test-ai-generation.mjs <xlsxPath> [商品番号(1-12)]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const xlsxPath = process.argv[2];
const targetNo = parseInt(process.argv[3] ?? '1', 10);

if (!xlsxPath) {
  console.error('使い方: node scripts/test-ai-generation.mjs <xlsxPath> [商品番号]');
  process.exit(1);
}

// ─── 商品情報抽出 ─────────────────────────────────────────────────────────────
const XLSX = (await import('xlsx')).default;
const buf = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: 'buffer' });

const ALIASES = {
  no: ['No.','No','NO','NO.','ＮＯ','№','No．','番号'],
  product_name: ['品名','商品名','品　名'],
  irisu: ['入数','入　数','入れ数'],
  min_lot: ['最小ロット','最小ﾛｯﾄ'],
  cost: ['単価','原価','仕入単価'],
};
const norm = (s) => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\s/g,'');
const matchH = (val, key) => val && ALIASES[key]?.some(a => norm(val) === norm(a));
const circled = (s) => { const C='①②③④⑤⑥⑦⑧⑨⑩⑪⑫'; const i=C.indexOf((s??'').trim()); return i>=0?i+1:parseInt(s,10)||null; };
const cellStr = (ws, addr) => { const c=ws[addr]; if(!c)return null; return String(c.v??'').trim()||null; };

let found = null;
for (const sheetName of wb.SheetNames) {
  if (found) break;
  const ws = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  let headerRow = -1, colMap = {};
  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const cm = {}; let cnt = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellStr(ws, XLSX.utils.encode_cell({r,c}));
      if (v) { for (const k of Object.keys(ALIASES)) if (matchH(v,k)){cm[k]=c;cnt++;} }
    }
    if (cnt >= 2) { headerRow=r; colMap=cm; break; }
  }
  if (headerRow < 0) continue;
  const get = (r, k) => { const c=colMap[k]; return c!=null?cellStr(ws,XLSX.utils.encode_cell({r,c})):null; };
  for (let r = headerRow+1; r <= range.e.r; r++) {
    const noStr = get(r, 'no');
    const no = circled(noStr);
    if (no === targetNo) {
      found = {
        no,
        leafName: get(r, 'product_name') ?? '商品',
        sheetName,
      };
      break;
    }
    if (noStr && noStr.includes('商品画像')) break;
  }
}

if (!found) {
  console.error(`商品番号 ${targetNo} が見つかりませんでした`);
  process.exit(1);
}

console.log(`\n対象商品: [${found.no}] ${found.leafName}`);

// ─── カテゴリ・フレーバー推定 ─────────────────────────────────────────────────
function detectCategory(name) {
  if (/ゼリー/.test(name)) return 'フルーツゼリー';
  if (/羊羹|ようかん|和菓子|あんこ|もなか|まんじゅう|せんべい|あられ|おかき|カステラ/.test(name)) return '和菓子';
  if (/チョコ|ショコラ|クッキー|バウム|ケーキ|グミ|キャンディ/.test(name)) return 'スイーツ';
  if (/ポップコーン|スナック|ポテト|ナッツ|豆菓子/.test(name)) return 'スナック';
  return '菓子';
}
function flavorOf(name) {
  const hits = [];
  if (/苺|いちご|あまおう/.test(name)) hits.push('あまおう苺');
  if (/白桃|桃|もも/.test(name)) hits.push('白桃');
  if (/メロン/.test(name)) hits.push('夕張メロン');
  if (/マスカット|ぶどう|巨峰|シャイン/.test(name)) hits.push('ぶどう');
  if (/マンゴー/.test(name)) hits.push('マンゴー');
  if (/さくらんぼ/.test(name)) hits.push('さくらんぼ');
  if (/キウイ/.test(name)) hits.push('キウイ');
  if (/レモン/.test(name)) hits.push('レモン');
  return hits.join('・') || name;
}

const category = detectCategory(found.leafName);
const flavor = flavorOf(found.leafName);
const themeLabel = category;

console.log(`カテゴリ: ${category} / フレーバー: ${flavor}`);

// ─── Gemini でプロンプト生成 ──────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY が未設定です'); process.exit(1); }

console.log('\n[1/3] Gemini で背景プロンプト生成中...');

const bgSystemPrompt = `あなたはプロのビジュアルディレクターです。
日本のゲームセンター景品向け販促リーフレットの「ビジュアル背景」を、Imagen 3 で生成するための英語プロンプトを作成してください。

【目的】
商品パッケージ画像・価格・テキストは後からシステムで合成します。
あなたが作るのは「その商品が映えるシーン・世界観・雰囲気の背景」です。

【やっていいこと】
- 商品の原材料・素材が自然の中に広がるシーン（例: 抹茶畑、フルーツが散らばる、水しぶき）
- 食欲をそそる食材のクローズアップや断面（商品パッケージ自体は描かない）
- 季節感・テクスチャ・光・グラデーションなどの雰囲気表現
- ポップアート、和モダン、カフェ風、夏祭りなど世界観の演出

【絶対にやってはいけないこと】
1. 商品パッケージそのものを描く
2. 文字・数字・ロゴ・価格を描く
3. 人物を描く
4. UIや枠線を描く

【構図の注意】
- 画面左〜中央に商品画像が来るため、その部分は視覚的にシンプルに
- 右側や上部は世界観が出ていてOK

【出力形式】
英語のプロンプトのみ（60〜100単語程度）。説明文は不要。`;

const bgUserPrompt = `商品情報:
商品名: ${found.leafName}
カテゴリ: ${category}
味・特徴・素材: ${flavor}
想定テーマ: ${themeLabel}

この商品の販促リーフレット用の、魅力的で世界観のある背景ビジュアルを生成するための英語プロンプトを出力してください。
商品パッケージ本体・文字・人物は含めないでください。`;

const bgRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: bgUserPrompt }] }],
      systemInstruction: { parts: [{ text: bgSystemPrompt }] },
      generationConfig: { temperature: 0.85, maxOutputTokens: 256 },
    }),
  }
);
const bgJson = await bgRes.json();
if (!bgRes.ok || bgJson.error) console.error('Gemini BG error:', JSON.stringify(bgJson).slice(0, 300));
const rawBgPrompt = bgJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
const imagenPrompt = `${rawBgPrompt}, NO product packaging, NO text, NO numbers, NO people, high quality, 16:9 aspect ratio, promotional visual background.`;

console.log('\n━━ Imagen3 プロンプト ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(imagenPrompt);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ─── キャッチコピー生成 ───────────────────────────────────────────────────────
console.log('\n[2/3] Gemini でキャッチコピー生成中...');

const cpPrompt = `あなたはゲームセンター景品の販促リーフレットのコピーライターです。
以下の商品情報をもとに、思わず手が伸びるキャッチコピーを作成してください。

【商品情報】
商品名: ${found.leafName}
カテゴリ: ${category}
味・特徴: ${flavor}
販売時期: 夏

【コピーの方針】
- メインコピー: 20文字以内。インパクト重視。商品の一番の魅力を一言で。
  - 味・食感・見た目・驚きなど、読んだ瞬間に「これ欲しい」と思わせる言葉を選ぶ
  - 「！」など記号を1つ使ってもOK
- サブコピー: 30文字以内。メインを補完する具体的な説明。
  - 食べ方・食感・シチュエーション・素材の良さなど
  - 景品としての「もらって嬉しい」感も意識する

【禁止事項】
- 「絶品」「最高級」「必ず売れる」など過度な断定表現
- 商品名をそのまま長く繰り返す

出力はJSONのみ（コードブロック不要）:
{"main_copy":"メインコピー","sub_copy":"サブコピー"}`;

const cpRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: cpPrompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 256 },
    }),
  }
);
const cpJson = await cpRes.json();
const cpRaw = cpJson.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
const cpJsonStr = cpRaw.replace(/```json?/g,'').replace(/```/g,'').trim();

console.log('\n━━ キャッチコピー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
try {
  const cp = JSON.parse(cpJsonStr);
  console.log(`メイン: ${cp.main_copy}`);
  console.log(`サブ:   ${cp.sub_copy}`);
} catch {
  console.log(cpRaw);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ─── Gemini 画像生成（課金が必要なため、SKIP_IMAGE=1 でスキップ可能）────────────────
if (process.env.SKIP_IMAGE === '1') {
  console.log('\n[3/3] 画像生成をスキップ（課金が必要: ai.dev で請求を有効化してください）');
  process.exit(0);
}
console.log('\n[3/3] Gemini で画像生成中（〜30秒）...');
const imgRes = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${GEMINI_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: imagenPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  }
);

if (!imgRes.ok) {
  console.error('Gemini 画像生成エラー:', imgRes.status, await imgRes.text());
  process.exit(1);
}

const imgJson = await imgRes.json();
const parts = imgJson.candidates?.[0]?.content?.parts ?? [];
const imgPart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
if (!imgPart) {
  console.error('画像データなし:', JSON.stringify(imgJson).slice(0, 400));
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'leaf-render-out', 'ai-test');
fs.mkdirSync(outDir, { recursive: true });
const ext = imgPart.inlineData.mimeType.split('/')[1] ?? 'png';
const outPath = path.join(outDir, `bg-${found.no}-${found.leafName.slice(0,10).replace(/[^\w]/g,'_')}.${ext}`);
fs.writeFileSync(outPath, Buffer.from(imgPart.inlineData.data, 'base64'));

console.log(`\n✅ 背景画像を保存しました: ${outPath}`);
console.log('Finderで確認してください。');
