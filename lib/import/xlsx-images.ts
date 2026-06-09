/**
 * Excel埋め込み画像抽出 (仕様書 v2.1 §5.3)
 *
 * xlsx を zip として展開し、xl/drawings/*.xml のアンカー位置から
 * 商品No.（①〜⑫）との対応を機械的に特定する。
 *
 * 実見積の実レイアウト（重要）:
 *  - 画像は oneCellAnchor で配置される（twoCellAnchor ではない）。
 *  - 商品①〜⑥は同一行に「列違い」で並ぶ（行ではなく列で商品を区別する）。
 *  - 次の行に⑦〜⑫が同様に並ぶ。
 *  - 先頭にロゴ画像（最上部の行）が1枚入ることがある → 商品エリア外として除外。
 *  - 1ファイルが複数シート（御見積書_01/02/03…）の場合、各シートが
 *    別々の drawing を持ち、シートごとに①〜⑫を再採番する。
 *    → 画像はシート名でタグ付けし、取込側でシート単位に突き合わせる。
 *
 * SheetJS Community版は画像/アンカー抽出不可のため zip を直接解析する。
 */
import * as path from 'path';

export type ExtractedImage = {
  no: number;               // シート内の商品No（1〜12）
  sheetName: string | null; // 所属シート名（マルチシート対応）
  mediaPath: string;        // zip内のメディアパス
  mimeType: string;
  buffer: Buffer;
};

export type ImageExtractionResult = {
  images: ExtractedImage[];
  unmatched: { mediaPath: string; anchorRow: number; sheetName: string | null }[];
};

type ZipLike = {
  files: Record<string, { async(type: 'text' | 'arraybuffer'): Promise<string | ArrayBuffer> }>;
};

async function readText(zip: ZipLike, file: string): Promise<string> {
  const entry = zip.files[file];
  if (!entry) return '';
  return (await entry.async('text')) as string;
}

/**
 * drawingファイル名（例: "drawing1.xml"）→ シート名 の対応表を作る。
 * workbook.xml（シート名↔r:id）→ workbook.xml.rels（r:id↔sheetN.xml）
 * → sheetN.xml.rels（sheetN↔drawingM）の連鎖をたどる。
 */
async function buildDrawingToSheet(zip: ZipLike): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // drawingFile -> sheetName
  const wb = await readText(zip, 'xl/workbook.xml');
  const wbRels = await readText(zip, 'xl/_rels/workbook.xml.rels');
  if (!wb) return result;

  // r:id -> worksheets/sheetN.xml
  const ridToTarget = new Map<string, string>();
  for (const m of wbRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
    ridToTarget.set(m[1], m[2]);
  }

  // <sheet name="..." ... r:id="rIdN"/>（属性順は name が先の前提でよい）
  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const name = m[1];
    const rid = m[2];
    const target = ridToTarget.get(rid);
    if (!target) continue;
    const sheetFile = target.split('/').pop(); // sheet1.xml
    if (!sheetFile) continue;

    const sheetRels = await readText(zip, `xl/worksheets/_rels/${sheetFile}.rels`);
    const dm = sheetRels.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
    if (dm) {
      const drawingFile = dm[1].split('/').pop();
      if (drawingFile) result.set(drawingFile, name);
    }
  }
  return result;
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return map[ext] ?? 'image/jpeg';
}

/**
 * xlsx の zip を展開して埋め込み画像を抽出し、シート名＋商品No.に対応付ける。
 *
 * @param xlsxBuffer xlsx ファイルのバイナリ
 * @param imageAreaStartRow 商品画像エリアの開始行（0-indexed）。これ未満はロゴ等として除外。
 * @param productsPerRow 1行あたりの商品数（既定6 = ①〜⑥ / ⑦〜⑫）
 */
export async function extractXlsxImages(
  xlsxBuffer: Buffer,
  imageAreaStartRow: number = 20,
  productsPerRow: number = 6,
): Promise<ImageExtractionResult> {
  const JSZipModule = await import('jszip');
  const zip = (await JSZipModule.default.loadAsync(xlsxBuffer)) as unknown as ZipLike;

  const images: ExtractedImage[] = [];
  const unmatched: ImageExtractionResult['unmatched'] = [];

  const drawingToSheet = await buildDrawingToSheet(zip);

  const drawingFiles = Object.keys(zip.files).filter((f) =>
    /^xl\/drawings\/drawing\d+\.xml$/.test(f),
  );

  for (const drawingPath of drawingFiles) {
    const xml = await readText(zip, drawingPath);
    const drawingName = path.basename(drawingPath);
    const sheetName = drawingToSheet.get(drawingName) ?? null;

    // drawing の .rels（rId → メディアパス）
    const relsPath = `${path.dirname(drawingPath)}/_rels/${drawingName}.rels`;
    const relsContent = await readText(zip, relsPath);
    const rIdToMedia = new Map<string, string>();
    for (const m of relsContent.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
      const resolved = path
        .join(path.dirname(drawingPath), m[2])
        .replace(/\\/g, '/');
      rIdToMedia.set(m[1], resolved);
    }

    // oneCellAnchor / twoCellAnchor の両方をブロック単位で取得
    const blockRe = /<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g;
    type Anchor = { row: number; col: number; media: string };
    const anchors: Anchor[] = [];
    for (const blk of xml.matchAll(blockRe)) {
      const body = blk[0];
      const from = body.match(
        /<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/,
      );
      const emb = body.match(/r:embed="(rId\d+)"/);
      if (!from || !emb) continue;
      const media = rIdToMedia.get(emb[1]);
      if (!media || !zip.files[media]) continue;
      anchors.push({ col: parseInt(from[1], 10), row: parseInt(from[2], 10), media });
    }

    // 商品画像エリア（imageAreaStartRow以降）のみを対象。ロゴ等は除外。
    const areaAnchors = anchors.filter((a) => a.row >= imageAreaStartRow);

    // 行を昇順に → 行インデックスが「①〜⑥ / ⑦〜⑫」のブロックを決める
    const rowsSorted = [...new Set(areaAnchors.map((a) => a.row))].sort((x, y) => x - y);
    // 列位置の集合を昇順に → 列順位が商品No.の列方向位置を決める（欠番に強い）
    const colsSorted = [...new Set(areaAnchors.map((a) => a.col))].sort((x, y) => x - y);

    for (const a of areaAnchors) {
      const rowBlock = rowsSorted.indexOf(a.row);
      const colRank = colsSorted.indexOf(a.col);
      const no = rowBlock * productsPerRow + colRank + 1;

      const buffer = Buffer.from(
        (await zip.files[a.media].async('arraybuffer')) as ArrayBuffer,
      );
      images.push({
        no,
        sheetName,
        mediaPath: a.media,
        mimeType: extToMime(path.extname(a.media).toLowerCase()),
        buffer,
      });
    }

    // エリア外（ロゴ等）は unmatched として記録
    for (const a of anchors.filter((a) => a.row < imageAreaStartRow)) {
      unmatched.push({ mediaPath: a.media, anchorRow: a.row, sheetName });
    }
  }

  images.sort((a, b) => (a.sheetName ?? '').localeCompare(b.sheetName ?? '') || a.no - b.no);
  return { images, unmatched };
}
