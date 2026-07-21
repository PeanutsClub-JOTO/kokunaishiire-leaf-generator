/**
 * Excel埋め込み画像抽出
 *
 * 位置ヒューリスティック（行ブロック×列順位から商品Noを決める等）は用いず、
 * どこに配置されていても全ての画像を回収する。商品との紐付けは
 * `image-matching.ts` が「画像周辺のセル文字列」と「商品表の内容」の突合、
 * 続いてLLMの画像内容判定で行う。
 *
 * このモジュールは画像バイナリ+アンカー位置+アンカー周辺の少数セルの
 * テキスト（キャプション相当）だけを抽出する。
 */
import * as path from 'path';
import * as XLSX from 'xlsx';

export type ExtractedImage = {
  sheetName: string | null;
  mediaPath: string;
  mimeType: string;
  buffer: Buffer;
  anchorRow: number;    // 0-indexed
  anchorCol: number;    // 0-indexed
  /**
   * 画像アンカー周辺（±2行 / ±1列）のセル値を連結したもの。
   * 画像に直接紐付いているキャプション（JAN/商品コード/品名/価格 等）を拾う目的。
   */
  nearbyText: string;
};

export type ImageExtractionResult = {
  images: ExtractedImage[];
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
 * drawingファイル名 → シート名 の対応表。
 * workbook.xml → workbook.xml.rels → sheetN.xml.rels をたどる。
 */
async function buildDrawingToSheet(zip: ZipLike): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const wb = await readText(zip, 'xl/workbook.xml');
  const wbRels = await readText(zip, 'xl/_rels/workbook.xml.rels');
  if (!wb) return result;

  const ridToTarget = new Map<string, string>();
  for (const m of wbRels.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
    ridToTarget.set(m[1], m[2]);
  }

  for (const m of wb.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const name = m[1];
    const rid = m[2];
    const target = ridToTarget.get(rid);
    if (!target) continue;
    const sheetFile = target.split('/').pop();
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
 * 指定セルを中心に ±rowRadius 行 / ±colRadius 列の範囲のセル値を集めて連結する。
 * 空セルは飛ばし、余分な空白を潰して1文字列にする。
 */
export function collectNearbyText(
  ws: XLSX.WorkSheet | undefined,
  anchorRow: number,
  anchorCol: number,
  rowRadius = 2,
  colRadius = 1,
): string {
  if (!ws) return '';
  const parts: string[] = [];
  const rowStart = Math.max(0, anchorRow - rowRadius);
  const rowEnd = anchorRow + rowRadius;
  const colStart = Math.max(0, anchorCol - colRadius);
  const colEnd = anchorCol + colRadius;
  const merges: XLSX.Range[] = ws['!merges'] ?? [];

  const resolvedCell = (r: number, c: number): string | null => {
    for (const m of merges) {
      if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
        const cell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
        return cell?.v == null ? null : String(cell.v);
      }
    }
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell?.v == null ? null : String(cell.v);
  };

  const seen = new Set<string>();
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const v = resolvedCell(r, c);
      if (!v) continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      parts.push(trimmed);
    }
  }
  return parts.join(' ');
}

/**
 * xlsx の zip を展開して埋め込み画像を抽出する。
 * 位置に基づく振り分けは一切行わない（商品紐付けは呼び出し側の責務）。
 */
export async function extractXlsxImages(xlsxBuffer: Buffer): Promise<ImageExtractionResult> {
  const JSZipModule = await import('jszip');
  const zip = (await JSZipModule.default.loadAsync(xlsxBuffer)) as unknown as ZipLike;

  // 周辺テキスト取得用にワークブックも一度パースしておく
  let workbook: XLSX.WorkBook | null = null;
  try {
    workbook = XLSX.read(xlsxBuffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  } catch {
    workbook = null;
  }

  const images: ExtractedImage[] = [];
  const drawingToSheet = await buildDrawingToSheet(zip);

  const drawingFiles = Object.keys(zip.files).filter((f) =>
    /^xl\/drawings\/drawing\d+\.xml$/.test(f),
  );

  for (const drawingPath of drawingFiles) {
    const xml = await readText(zip, drawingPath);
    const drawingName = path.basename(drawingPath);
    const sheetName = drawingToSheet.get(drawingName) ?? null;
    const ws = sheetName && workbook ? workbook.Sheets[sheetName] : undefined;

    const relsPath = `${path.dirname(drawingPath)}/_rels/${drawingName}.rels`;
    const relsContent = await readText(zip, relsPath);
    const rIdToMedia = new Map<string, string>();
    for (const m of relsContent.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
      const resolved = path
        .join(path.dirname(drawingPath), m[2])
        .replace(/\\/g, '/');
      rIdToMedia.set(m[1], resolved);
    }

    // oneCellAnchor / twoCellAnchor をブロック単位で走査（画像=r:embedを持つもののみ）
    const blockRe = /<xdr:(oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/xdr:\1>/g;
    for (const blk of xml.matchAll(blockRe)) {
      const body = blk[0];
      const from = body.match(
        /<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/,
      );
      const emb = body.match(/r:embed="(rId\d+)"/);
      if (!from || !emb) continue;
      const media = rIdToMedia.get(emb[1]);
      if (!media || !zip.files[media]) continue;

      const anchorCol = parseInt(from[1], 10);
      const anchorRow = parseInt(from[2], 10);
      const buffer = Buffer.from(
        (await zip.files[media].async('arraybuffer')) as ArrayBuffer,
      );
      images.push({
        sheetName,
        mediaPath: media,
        mimeType: extToMime(path.extname(media).toLowerCase()),
        buffer,
        anchorRow,
        anchorCol,
        nearbyText: collectNearbyText(ws, anchorRow, anchorCol),
      });
    }
  }

  images.sort(
    (a, b) =>
      (a.sheetName ?? '').localeCompare(b.sheetName ?? '') ||
      a.anchorRow - b.anchorRow ||
      a.anchorCol - b.anchorCol,
  );
  return { images };
}
