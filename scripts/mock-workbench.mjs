// リーフ ワークベンチUI の完成イメージを静的モックでレンダリング（デザイン確認用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dir, '..');
const dir = path.join(root, 'leaf-render-out', 'pipeline-test');
const b64 = (f) => `data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;

const gallery = [
  { f: '御見積書_01_assort_No1-2-3.png', name: '涼ごこち 苺・白桃・夕張メロン', tag: 'アソート3種', unit: 150, active: true },
  { f: '御見積書_01_assort_No1-2-4.png', name: '涼ごこち 苺・白桃・マスカット', tag: 'アソート3種', unit: 150 },
  { f: '御見積書_01_assort_No1-3-4.png', name: '涼ごこち 苺・夕張・マスカット', tag: 'アソート3種', unit: 150 },
  { f: '御見積書_02_assort_No2-4.png', name: '夕張メロン・あまおう苺', tag: 'アソート2種', unit: 390 },
  { f: '御見積書_02_No1.png', name: '愛媛県産せとかひとくちゼリー', tag: '単品', unit: 260 },
  { f: '御見積書_03_assort_No3-4.png', name: '宇治抹茶・フルーツケーキ', tag: 'アソート2種', unit: 225 },
];
const preview = gallery[0];

const thumbs = gallery.map((g) => `
  <button class="card ${g.active ? 'active' : ''}">
    <div class="thumb"><img src="${b64(g.f)}" /></div>
    <div class="cname">${g.name}</div>
    <div class="cmeta"><span class="badge ${g.tag === '単品' ? '' : 'assort'}">${g.tag}</span><span>単価${g.unit}円</span></div>
  </button>`).join('');

const sliders = ['福岡県産あまおう苺ゼリー', '山梨県産白桃ゼリー', '北海道産夕張メロンゼリー'].map((n) => `
  <div class="slider">
    <div class="srow"><span>${n}</span><b>×1</b></div>
    <input type="range" min="0" max="5" value="1" />
  </div>`).join('');

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; font-family: 'Hiragino Sans','Yu Gothic',sans-serif; }
  body { width: 1400px; height: 820px; background: #f4f4f5; }
  .header { background:#fff; border-bottom:1px solid #e4e4e7; padding:14px 24px; }
  .crumb { font-size:11px; color:#a1a1aa; margin-bottom:4px; }
  .htitle { font-size:18px; font-weight:700; color:#18181b; }
  .hsub { font-size:13px; color:#71717a; margin-top:2px; }
  .body { display:flex; height:740px; }
  aside.left { width:256px; background:#fafafa; border-right:1px solid #e4e4e7; padding:12px; overflow-y:auto; }
  .card { display:block; width:100%; text-align:left; background:#fff; border:1px solid #e4e4e7; border-radius:8px; padding:8px; margin-bottom:8px; cursor:pointer; }
  .card.active { border-color:#818cf8; box-shadow:0 0 0 1px #a5b4fc; }
  .thumb { aspect-ratio:16/10; background:#f4f4f5; border-radius:4px; overflow:hidden; display:flex; }
  .thumb img { width:100%; height:100%; object-fit:cover; }
  .cname { font-size:12px; font-weight:600; color:#27272a; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cmeta { display:flex; gap:5px; font-size:10px; color:#71717a; margin-top:2px; align-items:center; }
  .badge { background:#f4f4f5; border-radius:3px; padding:1px 4px; }
  .badge.assort { background:#fef3c7; color:#b45309; }
  main { flex:1; background:#f4f4f5; padding:24px; display:flex; flex-direction:column; align-items:center; }
  .preview { width:770px; height:485px; border-radius:8px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.18); }
  .preview img { width:770px; height:485px; object-fit:cover; }
  .phint { margin-top:12px; font-size:12px; color:#71717a; }
  aside.right { width:320px; background:#fff; border-left:1px solid #e4e4e7; padding:16px; overflow-y:auto; }
  label { display:block; font-size:11px; font-weight:600; color:#71717a; margin:0 0 4px; }
  .field { width:100%; border:1px solid #d4d4d8; border-radius:6px; padding:7px 9px; font-size:13px; margin-bottom:14px; }
  textarea.field { resize:none; }
  .slider { margin-bottom:10px; }
  .srow { display:flex; justify-content:space-between; font-size:12px; color:#52525b; margin-bottom:3px; }
  .slider input { width:100%; }
  .calc { background:#fafafa; border:1px solid #e4e4e7; border-radius:8px; padding:12px; margin:8px 0 14px; }
  .calc div { display:flex; justify-content:space-between; font-size:13px; margin:3px 0; }
  .calc .k { color:#71717a; font-size:12px; } .calc .v { font-weight:700; color:#18181b; }
  .btn { width:100%; border-radius:8px; padding:9px; font-size:13px; font-weight:600; margin-bottom:8px; cursor:pointer; border:0; }
  .btn.primary { background:#4f46e5; color:#fff; }
  .btn.ghost { background:#fff; color:#4338ca; border:1px solid #c7d2fe; }
  h4 { font-size:11px; color:#71717a; margin:4px 0 8px; }
</style></head><body>
  <div class="header">
    <div class="crumb">見積一覧 / 判定結果 / リーフ編集</div>
    <div class="htitle">リーフ ワークベンチ</div>
    <div class="hsub">株式会社ピーナッツクラブ ／ 全 24 リーフ</div>
  </div>
  <div class="body">
    <aside class="left">${thumbs}</aside>
    <main>
      <div class="preview"><img src="${b64(preview.f)}" /></div>
      <div class="phint">↑ 左で選択した内容を即時プレビュー（テキスト・比率を変えると自動連動）</div>
    </main>
    <aside class="right">
      <label>掲載品名</label>
      <textarea class="field" rows="2">涼ごこち福岡県産あまおう苺・山梨県産白桃・北海道産夕張メロンゼリー</textarea>
      <label>セールスコピー（空欄なら自動生成）</label>
      <textarea class="field" rows="3" placeholder="あまおう苺・白桃・夕張メロンの3種アソートです。"></textarea>
      <label>受注後納期</label>
      <input class="field" value="受注後約1週間" />
      <h4>アソート比率</h4>
      ${sliders}
      <div class="calc">
        <div><span class="k">単価</span><span class="v">150円</span></div>
        <div><span class="k">入数</span><span class="v">180個</span></div>
        <div><span class="k">卸価格</span><span class="v">27,000円</span></div>
        <div><span class="k">ハーフ</span><span class="v">不可</span></div>
      </div>
      <button class="btn primary">保存（比率・情報）</button>
      <button class="btn ghost">リーフ画像を生成</button>
    </aside>
  </div>
</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 820, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
const out = path.join(root, 'leaf-render-out', 'workbench-mock.png');
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(out);
