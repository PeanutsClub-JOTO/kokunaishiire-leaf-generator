/**
 * 旧形式 .xls（BIFF8/OLE2）埋め込み画像抽出
 *
 * xlsx-images.ts と同じ方針: 位置ヒューリスティックはかけず、全ての画像を
 * anchor+周辺テキスト付きで返す。商品との紐付けは image-matching.ts が行う。
 */
import * as XLSX from 'xlsx';
import type { ExtractedImage, ImageExtractionResult } from './xlsx-images';
import { collectNearbyText } from './xlsx-images';

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
        const pngIdx = body.indexOf(PNG_SIG);
        const jpgIdx = body.indexOf(JPG_SIG);
        if (pngIdx >= 0 && (jpgIdx < 0 || pngIdx < jpgIdx)) {
          blips.push({ mimeType: 'image/png', buffer: body.slice(pngIdx) });
        } else if (jpgIdx >= 0) {
          blips.push({ mimeType: 'image/jpeg', buffer: body.slice(jpgIdx) });
        } else {
          blips.push(null);
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
        const nProps = verInst >> 4;
        let q = 0;
        for (let k = 0; k < nProps && q + 6 <= body.length; k++) {
          const id = body.readUInt16LE(q) & 0x3fff;
          const val = body.readUInt32LE(q + 2);
          if (id === 0x0104) curPib = val;
          q += 6;
        }
      } else if (type === 0xf010 && body.length >= 18) {
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

export async function extractXlsImages(xlsBuffer: Buffer): Promise<ImageExtractionResult> {
  const XLSXMod = (await import('xlsx')).default as typeof XLSX;
  const cfb = XLSXMod.CFB.read(xlsBuffer as unknown as Uint8Array, { type: 'buffer' });
  const entry = XLSXMod.CFB.find(cfb, 'Workbook') ?? XLSXMod.CFB.find(cfb, 'Book');
  if (!entry?.content) return { images: [] };

  const wb = Buffer.from(entry.content as Uint8Array);
  const records = scanBiffRecords(wb);
  const sheets = readSheets(wb, records);

  const globalsEnd = sheets[0]?.start ?? wb.length;
  const group = concatRecordsWithContinue(wb, records, 0x00eb, 0, globalsEnd);
  const blips = extractBlips(group);
  if (blips.every((b) => b === null)) return { images: [] };

  // 周辺テキスト取得用に SheetJS でも読み込む（別パス経由）
  let workbook: XLSX.WorkBook | null = null;
  try {
    workbook = XLSXMod.read(xlsBuffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  } catch {
    workbook = null;
  }

  const images: ExtractedImage[] = [];

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const end = sheets[i + 1]?.start ?? wb.length;
    const drawing = concatRecordsWithContinue(wb, records, 0x00ec, sheet.start, end);
    if (drawing.length === 0) continue;

    const ws = workbook ? workbook.Sheets[sheet.name] : undefined;

    const shapes = extractShapeAnchors(drawing).filter(
      (s): s is ShapeAnchor & { pib: number } =>
        s.pib !== null && s.pib >= 1 && s.pib <= blips.length && blips[s.pib - 1] !== null,
    );

    for (const s of shapes) {
      const blip = blips[s.pib - 1];
      if (!blip) continue;
      images.push({
        sheetName: sheet.name,
        mediaPath: `biff/blip${s.pib}`,
        mimeType: blip.mimeType,
        buffer: blip.buffer,
        anchorRow: s.row,
        anchorCol: s.col,
        nearbyText: collectNearbyText(ws, s.row, s.col),
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

export function isLegacyXls(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.readUInt32LE(0) === 0xe011cfd0 &&
    buffer.readUInt32LE(4) === 0xe11ab1a1
  );
}
