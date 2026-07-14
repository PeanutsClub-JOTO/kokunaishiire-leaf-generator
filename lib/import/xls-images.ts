/**
 * 旧形式 .xls（BIFF8/OLE2）埋め込み画像抽出
 *
 * .xls は zip ではなく OLE2 複合ドキュメントのため、xlsx-images.ts の
 * zip 解析は使えない。SheetJS 同梱の CFB パーサで Workbook ストリームを
 * 取り出し、BIFF レコードを直接走査する。
 *
 * 構造:
 *  - MsoDrawingGroup (0x00EB) + Continue (0x003C): Escher BSE ストアに
 *    画像バイナリ（PNG/JPEG blip）が pib 順で格納される。
 *  - 各シートサブストリームの MsoDrawing (0x00EC): 図形ごとに
 *    OPT レコードの pib プロパティ(0x0104) と ClientAnchor (0xF010) を持つ。
 *    アンカーの (row, col) から xlsx と同じ「行ブロック×列順位」で商品No.を決める。
 */
import type { ExtractedImage, ImageExtractionOptions, ImageExtractionResult } from './xlsx-images';

const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const JPG_SIG = Buffer.from('ffd8ff', 'hex');

type BiffRecord = { type: number; pos: number; len: number; dataStart: number };

type Blip = { mimeType: string; buffer: Buffer } | null;

type ShapeAnchor = { pib: number | null; col: number; row: number };

function scanBiffRecords(wb: Buffer): BiffRecord[] {
  const records: BiffRecord[] = [];
  let pos = 0;
  while (pos + 4 <= wb.length) {
    const type = wb.readUInt16LE(pos);
    const len = wb.readUInt16LE(pos + 2);
    records.push({ type, pos, len, dataStart: pos + 4 });
    pos += 4 + len;
  }
  return records;
}

/** BoundSheet8 (0x0085) からシート名とサブストリーム開始位置を得る */
function readSheets(wb: Buffer, records: BiffRecord[]): Array<{ name: string; start: number }> {
  const sheets: Array<{ name: string; start: number }> = [];
  for (const r of records) {
    if (r.type !== 0x0085) continue;
    const start = wb.readUInt32LE(r.dataStart);
    const cch = wb.readUInt8(r.dataStart + 6);
    const grbit = wb.readUInt8(r.dataStart + 7);
    const name =
      grbit & 1
        ? wb.slice(r.dataStart + 8, r.dataStart + 8 + cch * 2).toString('utf16le')
        : wb.slice(r.dataStart + 8, r.dataStart + 8 + cch).toString('latin1');
    sheets.push({ name, start });
  }
  return sheets;
}

/** 指定タイプのレコード（直後のContinue含む）を連結する */
function concatRecordsWithContinue(
  wb: Buffer,
  records: BiffRecord[],
  targetType: number,
  rangeStart = 0,
  rangeEnd = Number.MAX_SAFE_INTEGER,
): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.pos < rangeStart || r.pos >= rangeEnd) continue;
    if (r.type !== targetType) continue;
    parts.push(wb.slice(r.dataStart, r.dataStart + r.len));
    let j = i + 1;
    while (j < records.length && records[j].type === 0x003c) {
      parts.push(wb.slice(records[j].dataStart, records[j].dataStart + records[j].len));
      j++;
    }
  }
  return Buffer.concat(parts);
}

/** Escher BSE (0xF007) ストアから blip を pib 順に取り出す */
function extractBlips(group: Buffer): Blip[] {
  const blips: Blip[] = [];

  function walk(buf: Buffer): void {
    let p = 0;
    while (p + 8 <= buf.length) {
      const verInst = buf.readUInt16LE(p);
      const type = buf.readUInt16LE(p + 2);
      const len = buf.readUInt32LE(p + 4);
      const bodyLen = Math.min(len, buf.length - p - 8);
      const body = buf.slice(p + 8, p + 8 + bodyLen);
      if (type === 0xf007) {
        // BSE: 中身から画像シグネチャを探す（PNG/JPEG以外はプレースホルダ）
        const pngIdx = body.indexOf(PNG_SIG);
        const jpgIdx = body.indexOf(JPG_SIG);
        if (pngIdx >= 0 && (jpgIdx < 0 || pngIdx < jpgIdx)) {
          blips.push({ mimeType: 'image/png', buffer: body.slice(pngIdx) });
        } else if (jpgIdx >= 0) {
          blips.push({ mimeType: 'image/jpeg', buffer: body.slice(jpgIdx) });
        } else {
          blips.push(null); // pib 番号を保つため位置だけ確保
        }
      } else if ((verInst & 0x000f) === 0x000f) {
        walk(body);
      }
      p += 8 + len;
    }
  }

  walk(group);
  return blips;
}

/** シートの MsoDrawing から (pib, row, col) の図形一覧を得る */
function extractShapeAnchors(drawing: Buffer): ShapeAnchor[] {
  const shapes: ShapeAnchor[] = [];
  let curPib: number | null = null;

  function walk(buf: Buffer): void {
    let p = 0;
    while (p + 8 <= buf.length) {
      const verInst = buf.readUInt16LE(p);
      const type = buf.readUInt16LE(p + 2);
      const len = buf.readUInt32LE(p + 4);
      const bodyLen = Math.min(len, buf.length - p - 8);
      const body = buf.slice(p + 8, p + 8 + bodyLen);
      if (type === 0xf00b || type === 0xf121 || type === 0xf122) {
        // OPT: プロパティ配列から pib (0x0104) を拾う
        const nProps = verInst >> 4;
        let q = 0;
        for (let k = 0; k < nProps && q + 6 <= body.length; k++) {
          const id = body.readUInt16LE(q) & 0x3fff;
          const val = body.readUInt32LE(q + 2);
          if (id === 0x0104) curPib = val;
          q += 6;
        }
      } else if (type === 0xf010 && body.length >= 18) {
        // ClientAnchor: flag(2) + col1,dx1,row1,dy1,...（各2B）
        shapes.push({ pib: curPib, col: body.readUInt16LE(2), row: body.readUInt16LE(6) });
        curPib = null;
      } else if ((verInst & 0x000f) === 0x000f) {
        walk(body);
      }
      p += 8 + len;
    }
  }

  walk(drawing);
  return shapes;
}

/**
 * .xls（BIFF8）から埋め込み画像を抽出し、シート名＋商品No.に対応付ける。
 * 対応付けロジック（行ブロック×列順位）は xlsx 版と同一。
 */
export async function extractXlsImages(
  xlsBuffer: Buffer,
  imageAreaStartRowOrOptions: number | ImageExtractionOptions = 20,
  productsPerRowArg: number = 6,
): Promise<ImageExtractionResult> {
  const options: Required<ImageExtractionOptions> =
    typeof imageAreaStartRowOrOptions === 'number'
      ? {
          imageAreaStartRow: imageAreaStartRowOrOptions,
          productsPerRow: productsPerRowArg,
          includeInlineAnchors: false,
          inlineImageStartRow: 3,
        }
      : {
          imageAreaStartRow: imageAreaStartRowOrOptions.imageAreaStartRow ?? 20,
          productsPerRow: imageAreaStartRowOrOptions.productsPerRow ?? 6,
          includeInlineAnchors: imageAreaStartRowOrOptions.includeInlineAnchors ?? false,
          inlineImageStartRow: imageAreaStartRowOrOptions.inlineImageStartRow ?? 3,
        };
  const XLSX = (await import('xlsx')).default;
  const cfb = XLSX.CFB.read(xlsBuffer as unknown as Uint8Array, { type: 'buffer' });
  const entry = XLSX.CFB.find(cfb, 'Workbook') ?? XLSX.CFB.find(cfb, 'Book');
  if (!entry?.content) return { images: [], unmatched: [] };

  const wb = Buffer.from(entry.content as Uint8Array);
  const records = scanBiffRecords(wb);
  const sheets = readSheets(wb, records);

  // グローバル部の BSE ストア（画像本体）
  const globalsEnd = sheets[0]?.start ?? wb.length;
  const group = concatRecordsWithContinue(wb, records, 0x00eb, 0, globalsEnd);
  const blips = extractBlips(group);
  if (blips.every((b) => b === null)) return { images: [], unmatched: [] };

  const images: ExtractedImage[] = [];
  const unmatched: ImageExtractionResult['unmatched'] = [];

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const end = sheets[i + 1]?.start ?? wb.length;
    const drawing = concatRecordsWithContinue(wb, records, 0x00ec, sheet.start, end);
    if (drawing.length === 0) continue;

    const shapes = extractShapeAnchors(drawing).filter(
      (s): s is ShapeAnchor & { pib: number } =>
        s.pib !== null && s.pib >= 1 && s.pib <= blips.length && blips[s.pib - 1] !== null,
    );

    const areaShapes = shapes.filter((s) => s.row >= options.imageAreaStartRow);
    const inlineShapes = options.includeInlineAnchors
      ? shapes.filter(
          (s) => s.row >= options.inlineImageStartRow && s.row < options.imageAreaStartRow,
        )
      : [];
    const rowsSorted = [...new Set(areaShapes.map((s) => s.row))].sort((x, y) => x - y);
    const colsSorted = [...new Set(areaShapes.map((s) => s.col))].sort((x, y) => x - y);

    for (const s of areaShapes) {
      const blip = blips[s.pib - 1];
      if (!blip) continue;
      const rowBlock = rowsSorted.indexOf(s.row);
      const colRank = colsSorted.indexOf(s.col);
      images.push({
        no: rowBlock * options.productsPerRow + colRank + 1,
        sheetName: sheet.name,
        mediaPath: `biff/blip${s.pib}`,
        mimeType: blip.mimeType,
        buffer: blip.buffer,
        anchorRow: s.row,
        anchorCol: s.col,
        mappingStrategy: 'number_grid',
      });
    }

    for (const s of inlineShapes) {
      const blip = blips[s.pib - 1];
      if (!blip) continue;
      images.push({
        no: null,
        sheetName: sheet.name,
        mediaPath: `biff/blip${s.pib}`,
        mimeType: blip.mimeType,
        buffer: blip.buffer,
        anchorRow: s.row,
        anchorCol: s.col,
        mappingStrategy: 'inline_anchor',
      });
    }

    for (const s of shapes.filter(
      (s) =>
        s.row < options.imageAreaStartRow &&
        !(options.includeInlineAnchors && s.row >= options.inlineImageStartRow),
    )) {
      unmatched.push({
        mediaPath: `biff/blip${s.pib}`,
        anchorRow: s.row,
        anchorCol: s.col,
        sheetName: sheet.name,
      });
    }
  }

  const strategyRank = (s: ExtractedImage['mappingStrategy']) =>
    s === 'number_grid' ? 0 : 1;
  images.sort(
    (a, b) =>
      (a.sheetName ?? '').localeCompare(b.sheetName ?? '') ||
      strategyRank(a.mappingStrategy) - strategyRank(b.mappingStrategy) ||
      (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER) ||
      a.anchorRow - b.anchorRow ||
      a.anchorCol - b.anchorCol,
  );
  return { images, unmatched };
}

/** OLE2（旧xls）シグネチャ判定 */
export function isLegacyXls(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.readUInt32LE(0) === 0xe011cfd0 &&
    buffer.readUInt32LE(4) === 0xe11ab1a1
  );
}
