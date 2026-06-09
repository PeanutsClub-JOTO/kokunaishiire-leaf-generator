// 実XLSXから埋め込み画像を抽出し No.順に書き出して目視確認する開発用スクリプト
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const root = process.cwd();
const file = process.argv[2] || 'tests/fixtures/real/kanazawa.xlsx';
const buf = fs.readFileSync(path.join(root, file));
const zip = await JSZip.loadAsync(buf);

// drawing→sheet
async function txt(f){ return zip.files[f] ? await zip.files[f].async('text') : ''; }
const wb = await txt('xl/workbook.xml');
const wbRels = await txt('xl/_rels/workbook.xml.rels');
const ridT = new Map([...wbRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1],m[2]]));
const drawToSheet = new Map();
for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
  const sf = ridT.get(m[2])?.split('/').pop();
  const rels = await txt(`xl/worksheets/_rels/${sf}.rels`);
  const dm = rels.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
  if (dm) drawToSheet.set(dm[1].split('/').pop(), m[1]);
}

const outDir = path.join(root, 'leaf-render-out/extracted');
fs.mkdirSync(outDir, { recursive: true });

for (const dp of Object.keys(zip.files).filter(f=>/^xl\/drawings\/drawing\d+\.xml$/.test(f))) {
  const xml = await zip.files[dp].async('text');
  const name = path.basename(dp);
  const sheet = drawToSheet.get(name) ?? name;
  const rels = await txt(`xl/drawings/_rels/${name}.rels`);
  const rid2media = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)].map(m=>[m[1], path.join('xl/drawings', m[2]).replace(/\\/g,'/')]));
  const anchors=[];
  for (const blk of xml.matchAll(/<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g)) {
    const from = blk[0].match(/<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const emb = blk[0].match(/r:embed="(rId\d+)"/);
    if (from && emb) anchors.push({ col:+from[1], row:+from[2], media: rid2media.get(emb[1]) });
  }
  const area = anchors.filter(a=>a.row>=20);
  const rows=[...new Set(area.map(a=>a.row))].sort((a,b)=>a-b);
  const cols=[...new Set(area.map(a=>a.col))].sort((a,b)=>a-b);
  for (const a of area) {
    const no = rows.indexOf(a.row)*6 + cols.indexOf(a.col) + 1;
    const data = Buffer.from(await zip.files[a.media].async('arraybuffer'));
    const ext = path.extname(a.media);
    fs.writeFileSync(path.join(outDir, `${sheet}_no${String(no).padStart(2,'0')}${ext}`), data);
  }
}
console.log('dumped to', outDir);
console.log(fs.readdirSync(outDir).filter(f=>f.startsWith('御見積書_01')).sort().join('\n'));
