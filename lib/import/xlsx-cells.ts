/**
 * Excel (.xlsx) セル値抽出 (仕様書 v2.1 §5.1-5.2)
 *
 * SheetJS でセル値を抽出し、ヘッダー文字列で動的に列・行を特定する。
 * 固定行番号に依存しない。1ファイルに複数シートがある場合も対応。
 */
import * as XLSX from 'xlsx';
import { parseIrisu } from '../parse/irisu';
import { parseMinLot } from '../parse/minlot';
import { parseSpec } from '../parse/spec';
import { parseSalesPeriod, parseShelfLife } from '../parse/sales-period';

// ヘッダー列のエイリアス辞書（表記揺れ対応）
const HEADER_ALIASES: Record<string, string[]> = {
  no:          ['No.', 'No', 'NO', 'NO.', 'ＮＯ', '№', 'No．', '番号'],
  maker_name:  ['メーカー', 'メーカー名', 'Maker'],
  product_name:['品名', '商品名', '品　名'],
  spec:        ['規格', '規　格', 'Spec'],
  irisu:       ['入数', '入　数', '入れ数'],
  min_lot:     ['最小ロット', '最小ﾛｯﾄ', '最小lot', 'ﾐﾆﾏﾑﾛｯﾄ'],
  retail_price:['上代', '上　代', '希望小売価格', '定価'],
  cost:        ['単価', '原価', '仕入単価'],
  jan_code:    ['JANコード', 'JAN', 'JANｺｰﾄﾞ', 'EAN'],
  shelf_life:  ['賞味期間', '賞味期限', '消費期限', '賞味期間(夏期)', '賞味期間（夏期）'],
  sales_period:['販売期間', '取扱期間', '販売期間（予定）'],
  note:        ['備考', '特記事項', 'Note'],
};

export type RawProductRow = {
  no:               number | null;
  maker_name:       string | null;
  product_name:     string | null;
  spec_raw:         string | null;
  spec_pieces:      number | null;
  spec_grams:       number | null;
  irisu_raw:        string | null;
  case_qty:         number | null;
  lots_per_kou:     number | null;
  min_lot_raw:      string | null;
  min_lot_qty:      number | null;
  retail_price:     number | null;
  cost:             number | null;
  jan_code:         string | null;
  shelf_life_days:  number | null;
  sales_period_raw: string | null;
  sales_period_start: Date | null;
  sales_period_end:   Date | null;
  piece_size:       string | null;   // ピース寸法（W×D×H）。商品画像エリアから抽出
  note:             string | null;
  parse_errors:     string[];
};

export type RawSheetData = {
  sheet_name: string;
  maker_name: string | null;
  products:   RawProductRow[];
};

// 丸数字 ①〜⑫ を数値に変換
function parseCircledNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫';
  const idx = CIRCLED.indexOf(s.trim());
  if (idx >= 0) return idx + 1;
  // 数字だけの場合も許容
  const n = parseInt(String(s).trim(), 10);
  return isNaN(n) ? null : n;
}

// セル値を文字列として取得
function cellStr(ws: XLSX.WorkSheet, addr: string): string | null {
  const cell = ws[addr];
  if (!cell) return null;
  const v = cell.v;
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

// セル値を数値として取得
function cellNum(ws: XLSX.WorkSheet, addr: string): number | null {
  const cell = ws[addr];
  if (!cell) return null;
  const v = cell.v;
  if (typeof v === 'number') return v;
  const parsed = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(parsed) ? null : parsed;
}

// 全角英数字・記号を半角へ正規化（ＪＡＮ→JAN, ＮＯ．→NO. 等）。
// これにより実見積で多用される全角ヘッダーを半角エイリアスで吸収できる。
function normalizeHeader(s: string): string {
  return s
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s/g, '');
}

// 行内のいずれかのセルに指定テキストを含むか（セクション境界の検出に使用）
function rowContainsText(
  ws: XLSX.WorkSheet,
  r: number,
  range: XLSX.Range,
  needle: string,
): boolean {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = cellStr(ws, XLSX.utils.encode_cell({ r, c }));
    if (v && v.replace(/\s/g, '').includes(needle)) return true;
  }
  return false;
}

// ヘッダー文字列が定義済みエイリアスと一致するか
function matchHeader(cell: string | null, key: string): boolean {
  if (!cell) return false;
  const aliases = HEADER_ALIASES[key] ?? [];
  const normCell = normalizeHeader(cell);
  return aliases.some((alias) => normCell === normalizeHeader(alias));
}

/**
 * 抽出元（Excelセル / PDF表 / AI構造化抽出）に依存しない生フィールド。
 * これを normalizeRawProduct に渡すと、各パーサを通した RawProductRow になる。
 */
export type RawProductFields = {
  no:               number | string | null;
  maker_name:       string | null;
  product_name:     string;
  spec_raw:         string | null;
  irisu_raw:        string | null;
  min_lot_raw:      string | null;
  retail_price:     number | null;
  cost:             number | null;
  jan_code:         string | null;
  shelf_life_raw:   string | null;
  sales_period_raw: string | null;
  note:             string | null;
};

/**
 * 生フィールドを全パーサに通して RawProductRow を構築する。
 * Excelセル抽出・PDF表抽出・AI構造化抽出の全経路で共有し、
 * 「抽出はできたがパースされず数値が落ちる」事故を防ぐ。
 */
export function normalizeRawProduct(f: RawProductFields): RawProductRow {
  const parseErrors: string[] = [];

  const no = parseCircledNumber(f.no === null || f.no === undefined ? null : String(f.no));

  const specResult = parseSpec(f.spec_raw);
  if (specResult.parseError) parseErrors.push('spec_parse_error');

  const irisuResult = parseIrisu(f.irisu_raw);
  if (irisuResult.parseError) parseErrors.push('irisu_parse_error');

  const minLotResult = parseMinLot(
    f.min_lot_raw,
    irisuResult.caseQty,
    irisuResult.lotsPerKou,
  );
  if (minLotResult.parseError) parseErrors.push('minlot_parse_error');

  const shelfResult = parseShelfLife(f.shelf_life_raw);
  if (shelfResult.parseError) parseErrors.push('shelf_parse_error');

  const salesPeriodResult = parseSalesPeriod(f.sales_period_raw);
  if (salesPeriodResult.parseError) parseErrors.push('sales_period_parse_error');

  // 上代 > 原価 の整合チェック
  if (
    f.cost !== null &&
    f.retail_price !== null &&
    f.cost > f.retail_price
  ) {
    parseErrors.push('cost_retail_inverted');
  }

  return {
    no,
    maker_name: f.maker_name,
    product_name: f.product_name,
    spec_raw: f.spec_raw,
    spec_pieces: specResult.specPieces,
    spec_grams: specResult.specGrams,
    irisu_raw: f.irisu_raw,
    case_qty: irisuResult.caseQty || null,
    lots_per_kou: irisuResult.lotsPerKou || null,
    min_lot_raw: f.min_lot_raw,
    min_lot_qty: minLotResult.qty || null,
    retail_price: f.retail_price,
    cost: f.cost,
    jan_code: f.jan_code,
    shelf_life_days: shelfResult.parseError ? null : shelfResult.days,
    sales_period_raw: f.sales_period_raw,
    sales_period_start: salesPeriodResult.start,
    sales_period_end: salesPeriodResult.end,
    piece_size: null, // 商品画像エリアから別途抽出して後段でセット
    note: f.note,
    parse_errors: parseErrors,
  };
}

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫';
// ピース寸法セル（例: "W170×D62×H240"）。全角×(U+00D7)・半角xの揺れに対応
const DIM_RE = /[WＷ]?\s*\d+\s*[×xX✕]\s*[DＤ]?\s*\d+\s*[×xX✕]\s*[HＨ]?\s*\d+/u;

function isPieceLabel(s: string | null): boolean {
  if (!s) return false;
  return /ﾋﾟｰｽ|ピース/.test(s.replace(/\s/g, ''));
}

/**
 * 見積書下部「商品画像」エリアから商品No.→ピース寸法(W×D×H)を抽出する。
 *
 * レイアウト: ①②③④⑤⑥ が横方向に並ぶ「ブロック見出し行」があり、その下に
 * ﾋﾟｰｽ / ｹｰｽ / 甲 の寸法行が続く。商品サイズとしては最小単位の「ﾋﾟｰｽ」寸法を採用する。
 * ブロック見出しの丸数字セルの列位置で、寸法セルがどの商品に属するかを判定する。
 */
function extractPieceSizes(ws: XLSX.WorkSheet): Map<number, string> {
  const result = new Map<number, string>();
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');

  // 1行に丸数字が複数あれば「ブロック見出し行」とみなす（品名表のNo.列と区別）
  type Header = { row: number; markers: { col: number; no: number }[] };
  const headers: Header[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const markers: { col: number; no: number }[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellStr(ws, XLSX.utils.encode_cell({ r, c }));
      if (!v) continue;
      const idx = CIRCLED_NUMS.indexOf(v.trim());
      if (idx >= 0) markers.push({ col: c, no: idx + 1 });
    }
    if (markers.length >= 2) {
      markers.sort((a, b) => a.col - b.col);
      headers.push({ row: r, markers });
    }
  }

  for (let h = 0; h < headers.length; h++) {
    const header = headers[h];
    const nextRow = h + 1 < headers.length ? headers[h + 1].row : range.e.r + 1;

    // ブロック見出しの直後〜次の見出し手前で、最初に現れる「ﾟｰｽ」行を探す
    for (let r = header.row + 1; r < nextRow; r++) {
      let hasPieceLabel = false;
      const dims: { col: number; value: string }[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const v = cellStr(ws, XLSX.utils.encode_cell({ r, c }));
        if (!v) continue;
        if (isPieceLabel(v)) hasPieceLabel = true;
        const m = v.match(DIM_RE);
        if (m) dims.push({ col: c, value: m[0].replace(/\s/g, '') });
      }
      if (!hasPieceLabel) continue;

      // 各寸法セルを、列位置が左側で最も近い丸数字マーカーの商品に割り当てる
      for (const dim of dims) {
        let owner: number | null = null;
        for (const mk of header.markers) {
          if (mk.col <= dim.col) owner = mk.no;
          else break;
        }
        if (owner !== null && !result.has(owner)) result.set(owner, dim.value);
      }
      break; // この見出しブロックのﾟｰｽ行は1つだけ処理
    }
  }

  return result;
}

// シートからヘッダー行とカラムマップを検出
type ColMap = Partial<Record<keyof typeof HEADER_ALIASES, number>>;

function detectHeaderRow(ws: XLSX.WorkSheet): {
  headerRow: number;
  colMap: ColMap;
} | null {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');

  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const colMap: ColMap = {};
    let matchCount = 0;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const val = cellStr(ws, addr);

      for (const key of Object.keys(HEADER_ALIASES)) {
        if (matchHeader(val, key)) {
          (colMap as Record<string, number>)[key] = c;
          matchCount++;
        }
      }
    }

    // 主要ヘッダー（品名・単価・最小ロット）が3つ以上見つかればヘッダー行と判定
    if (matchCount >= 3) {
      return { headerRow: r, colMap };
    }
  }

  return null;
}

// 1シート分を処理してRawSheetDataを返す
function extractSheet(ws: XLSX.WorkSheet, sheetName: string): RawSheetData {
  const detected = detectHeaderRow(ws);
  if (!detected) {
    return { sheet_name: sheetName, maker_name: null, products: [] };
  }

  const { headerRow, colMap } = detected;
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  const products: RawProductRow[] = [];
  let sheetMakerName: string | null = null;

  // ヘッダー行の次の行から商品データを取得する。
  // 上限は固定12行ではなく「商品画像」セクション到達 or 連続空行で打ち切る
  // （13商品以上の見積でも取りこぼさないため）。
  let emptyStreak = 0;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const get = (key: keyof typeof HEADER_ALIASES) => {
      const c = (colMap as Record<string, number | undefined>)[key];
      return c !== undefined ? cellStr(ws, XLSX.utils.encode_cell({ r, c })) : null;
    };
    const getNum = (key: keyof typeof HEADER_ALIASES) => {
      const c = (colMap as Record<string, number | undefined>)[key];
      return c !== undefined ? cellNum(ws, XLSX.utils.encode_cell({ r, c })) : null;
    };

    // 「商品画像」セクションに入ったら商品表は終了
    if (rowContainsText(ws, r, range, '商品画像')) break;

    // 品名がない行はスキップ（空行）。商品が出始めた後で空行が続いたら表の終端とみなす。
    const productName = get('product_name');
    if (!productName) {
      emptyStreak++;
      if (products.length > 0 && emptyStreak >= 3) break;
      continue;
    }
    emptyStreak = 0;

    // メーカー名（シート内で最初に見つかったものをシートのmaker_nameとして使う）
    const makerName = get('maker_name');
    if (makerName && !sheetMakerName) sheetMakerName = makerName;

    products.push(
      normalizeRawProduct({
        no: get('no'),
        maker_name: makerName ?? sheetMakerName,
        product_name: productName,
        spec_raw: get('spec'),
        irisu_raw: get('irisu'),
        min_lot_raw: get('min_lot'),
        retail_price: getNum('retail_price'),
        cost: getNum('cost'),
        jan_code: get('jan_code'),
        shelf_life_raw: get('shelf_life'),
        sales_period_raw: get('sales_period'),
        note: get('note'),
      }),
    );
  }

  // 商品画像エリアからピース寸法を抽出し、商品No.で突き合わせて商品サイズにセット
  const pieceSizes = extractPieceSizes(ws);
  if (pieceSizes.size > 0) {
    for (const p of products) {
      if (p.no !== null && pieceSizes.has(p.no)) {
        p.piece_size = pieceSizes.get(p.no) ?? null;
      }
    }
  }

  return { sheet_name: sheetName, maker_name: sheetMakerName, products };
}

/**
 * xlsx バッファから全シートのデータを抽出する
 */
export function extractXlsxCells(buffer: Buffer): RawSheetData[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return workbook.SheetNames.map((name) =>
    extractSheet(workbook.Sheets[name], name),
  );
}
