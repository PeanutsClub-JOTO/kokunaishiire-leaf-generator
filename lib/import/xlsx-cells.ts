/**
 * Excel (.xlsx) セル値抽出 (仕様書 v2.1 §5.1-5.2)
 *
 * SheetJS でセル値を抽出し、ヘッダー文字列で動的に列・行を特定する。
 * 固定行番号に依存しない。1ファイルに複数シートがある場合も対応。
 */
import * as XLSX from 'xlsx';
import { parseIrisu } from '../parse/irisu';
import { parseLooseNumber } from './number';
import { parseMinLot } from '../parse/minlot';
import { parseSpec } from '../parse/spec';
import { parseSalesPeriod, parseShelfLife } from '../parse/sales-period';

// ヘッダー列のエイリアス辞書（表記揺れ対応）
const HEADER_ALIASES: Record<string, string[]> = {
  no:          ['No.', 'No', 'NO', 'NO.', 'ＮＯ', '№', 'No．', '番号'],
  maker_name:  ['メーカー', 'メーカー名', 'ブランド', 'ブランド名', 'Maker'],
  product_name:['品名', '商品名', '品　名'],
  spec:        ['規格', '規　格', '内容量', '容量', 'サイズ', 'Spec'],
  irisu:       ['入数', '入　数', '入れ数', '入り数', 'ケース入数', '梱入数'],
  min_lot:     ['最小ロット', '最小ﾛｯﾄ', '最小lot', 'ﾐﾆﾏﾑﾛｯﾄ', '発注単位', '発注ロット', 'ロット', 'MOQ', '最小発注数'],
  retail_price:['上代', '上　代', '希望小売価格', 'メーカー希望小売価格', '定価', '参考売価', '推奨売価', '売価'],
  cost:        ['単価', '単価（税抜）', '単価(税込)', '原価', '仕入単価', '仕入価格', '仕切', '仕切価格', '納価', '納品価格', 'NET価格', 'ＮＥＴ価格', '卸単価'],
  jan_code:    ['JANコード', 'JAN', 'JANｺｰﾄﾞ', 'EAN'],
  shelf_life:  ['賞味期間', '賞味期限', '賞味', '消費期限', '賞味期間(夏期)', '賞味期間（夏期）'],
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
  source_row?:       number | null;  // Excel上の元行（0-indexed）。画像紐付け用の内部情報
  source_col?:       number | null;  // Excel上の商品/JAN列（0-indexed）。横並びカタログの画像紐付け用
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

/**
 * 結合セルの先頭アドレスを返す。
 * 結合範囲内のセルは SheetJS が値を持たないため、ws['!merges'] を参照して
 * 先頭セル（s）の値を代わりに返す。結合外のセルはそのまま。
 */
function resolvedAddr(ws: XLSX.WorkSheet, r: number, c: number): string {
  const merges: XLSX.Range[] = ws['!merges'] ?? [];
  for (const m of merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
      return XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
    }
  }
  return XLSX.utils.encode_cell({ r, c });
}

function mergedRangeAt(ws: XLSX.WorkSheet, r: number, c: number): XLSX.Range | null {
  const merges: XLSX.Range[] = ws['!merges'] ?? [];
  for (const m of merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return m;
  }
  return null;
}

// セル値を文字列として取得（結合セル対応）
function cellStr(ws: XLSX.WorkSheet, addr: string): string | null {
  const { r, c } = XLSX.utils.decode_cell(addr);
  const resolved = resolvedAddr(ws, r, c);
  const cell = ws[resolved];
  if (!cell) return null;
  const v = cell.v;
  if (v === null || v === undefined) return null;
  return String(v).trim() || null;
}

// セル値を数値として取得（結合セル対応）
function cellNum(ws: XLSX.WorkSheet, addr: string): number | null {
  const { r, c } = XLSX.utils.decode_cell(addr);
  const resolved = resolvedAddr(ws, r, c);
  const cell = ws[resolved];
  if (!cell) return null;
  return parseLooseNumber(cell.v);
}

// 全角英数字・記号を半角へ正規化（ＪＡＮ→JAN, ＮＯ．→NO. 等）。
// これにより実見積で多用される全角ヘッダーを半角エイリアスで吸収できる。
function normalizeHeader(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s/g, '');
}

const HEADER_LIKE_TEXTS = new Set([
  ...Object.values(HEADER_ALIASES).flat().map(normalizeHeader),
  '税抜',
  '税込',
  '日',
  '重量',
  '縦',
  '横',
  '高さ',
  '(g)',
  '(mm)',
  'ケース',
  'ボール',
  'ピース',
  '注文数',
  '発注数',
  '数量',
]);

function isHeaderLikeText(s: string): boolean {
  return HEADER_LIKE_TEXTS.has(normalizeHeader(s));
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
  return aliases.some((alias) => {
    const normAlias = normalizeHeader(alias);
    return normCell === normAlias || normCell.includes(normAlias);
  });
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

function hasRawValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

function normalizeJanCode(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.normalize('NFKC').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * 生フィールドを全パーサに通して RawProductRow を構築する。
 * Excelセル抽出・PDF表抽出・AI構造化抽出の全経路で共有し、
 * 「抽出はできたがパースされず数値が落ちる」事故を防ぐ。
 */
export function normalizeRawProduct(f: RawProductFields): RawProductRow {
  const parseErrors: string[] = [];

  const no = parseCircledNumber(f.no === null || f.no === undefined ? null : String(f.no));

  const specResult = parseSpec(f.spec_raw);
  if (specResult.parseError && hasRawValue(f.spec_raw)) parseErrors.push('spec_parse_error');

  const irisuResult = parseIrisu(f.irisu_raw);
  if (irisuResult.parseError && hasRawValue(f.irisu_raw)) parseErrors.push('irisu_parse_error');

  const minLotResult = parseMinLot(
    f.min_lot_raw,
    irisuResult.caseQty,
    irisuResult.lotsPerKou,
  );
  if (minLotResult.parseError && hasRawValue(f.min_lot_raw)) parseErrors.push('minlot_parse_error');
  const minLotQty =
    hasRawValue(f.min_lot_raw)
      ? minLotResult.qty || null
      : irisuResult.parseError
        ? null
        : irisuResult.caseQty * irisuResult.lotsPerKou;

  const shelfResult = parseShelfLife(f.shelf_life_raw);
  if (shelfResult.parseError && hasRawValue(f.shelf_life_raw)) parseErrors.push('shelf_parse_error');

  const salesPeriodResult = parseSalesPeriod(f.sales_period_raw);
  if (salesPeriodResult.parseError && hasRawValue(f.sales_period_raw)) {
    parseErrors.push('sales_period_parse_error');
  }

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
    min_lot_qty: minLotQty,
    retail_price: f.retail_price,
    cost: f.cost,
    jan_code: normalizeJanCode(f.jan_code),
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
type ColRangeMap = Partial<Record<keyof typeof HEADER_ALIASES, { start: number; end: number }>>;

function detectHeaderRow(ws: XLSX.WorkSheet): {
  headerRow: number;
  colMap: ColMap;
  colRanges: ColRangeMap;
} | null {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');

  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const colMap: ColMap = {};
    const colRanges: ColRangeMap = {};

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const val = cellStr(ws, addr);

      for (const key of Object.keys(HEADER_ALIASES)) {
        if (matchHeader(val, key)) {
          // 結合セルは各列で同じヘッダー値として解決されるため、同一ヘッダーが
          // 横に連続して見える。後ろの列で上書きすると「240日 / (240日)」の
          // 後半だけを拾う事故が起きるので、最初に見つけた列を採用する。
          if ((colMap as Record<string, number | undefined>)[key] === undefined) {
            (colMap as Record<string, number>)[key] = c;
            const merged = mergedRangeAt(ws, r, c);
            (colRanges as Record<string, { start: number; end: number }>)[key] = merged
              ? { start: merged.s.c, end: merged.e.c }
              : { start: c, end: c };
          }
        }
      }
    }

    const hasProductName = (colMap as Record<string, number | undefined>).product_name !== undefined;
    const supportKeys = [
      'no',
      'maker_name',
      'spec',
      'irisu',
      'min_lot',
      'retail_price',
      'cost',
      'jan_code',
      'shelf_life',
      'sales_period',
      'note',
    ];
    const supportCount = supportKeys.filter(
      (key) => (colMap as Record<string, number | undefined>)[key] !== undefined,
    ).length;
    const hasCommercialValue =
      (colMap as Record<string, number | undefined>).cost !== undefined ||
      (colMap as Record<string, number | undefined>).retail_price !== undefined ||
      (colMap as Record<string, number | undefined>).jan_code !== undefined ||
      (colMap as Record<string, number | undefined>).irisu !== undefined;

    // 商品名列を必須にし、本文中の「卸単価」などの注意書きをヘッダー扱いしない。
    if (hasProductName && (supportCount >= 2 || hasCommercialValue)) {
      return { headerRow: r, colMap, colRanges };
    }
  }

  return null;
}

function compactText(s: string): string {
  return s.normalize('NFKC').replace(/\s/g, '').trim();
}

function isNonProductText(s: string): boolean {
  const compact = compactText(s);
  if (!compact) return true;
  if (isHeaderLikeText(s)) return true;
  if (/^【[^】]+】$/.test(compact)) return true;
  if (compact.startsWith('※')) return true;
  if (/^[●■◆◇○]+/.test(compact)) return true;
  return /^(合計|小計|送料|手数料|消費税|条件欄|配送条件|配送ロット|配送エリア)$/.test(compact) ||
    compact.includes('季節品販売期間') ||
    compact.includes('配送ロット') ||
    compact.includes('配送エリア');
}

function cleanProductName(s: string): string {
  return s.replace(/^★+/, '').trim();
}

type ProductNameRangeStats = {
  likelyMakerCols: Set<number>;
};

function analyzeProductNameRange(
  ws: XLSX.WorkSheet,
  headerRow: number,
  productRange: { start: number; end: number },
  sheetRange: XLSX.Range,
): ProductNameRangeStats {
  const valuesByCol = new Map<number, string[]>();
  for (let c = productRange.start; c <= productRange.end; c++) valuesByCol.set(c, []);

  for (let r = headerRow + 1; r <= sheetRange.e.r; r++) {
    if (rowContainsText(ws, r, sheetRange, '商品画像')) break;
    for (let c = productRange.start; c <= productRange.end; c++) {
      const value = cellStr(ws, XLSX.utils.encode_cell({ r, c }));
      if (!value || isNonProductText(value)) continue;
      valuesByCol.get(c)?.push(compactText(value));
    }
  }

  const likelyMakerCols = new Set<number>();
  for (const [col, values] of valuesByCol) {
    const uniqueCount = new Set(values).size;
    if (values.length >= 2 && uniqueCount <= Math.max(1, Math.floor(values.length / 3))) {
      likelyMakerCols.add(col);
    }
  }

  return { likelyMakerCols };
}

function productNameScore(
  candidate: { col: number; value: string },
  stats: ProductNameRangeStats,
  hasMultipleCandidates: boolean,
): number {
  let score = compactText(candidate.value).length;
  if (hasMultipleCandidates && stats.likelyMakerCols.has(candidate.col)) score -= 100;
  if (/[（(].+[）)]/.test(candidate.value)) score += 2;
  if (/[0-9０-９]/.test(candidate.value)) score += 1;
  return score;
}

function extractProductIdentity(
  ws: XLSX.WorkSheet,
  row: number,
  productRange: { start: number; end: number },
  stats: ProductNameRangeStats,
): { productName: string | null; makerName: string | null; productCol: number | null } {
  const candidates: { col: number; value: string }[] = [];
  const seen = new Set<string>();

  for (let c = productRange.start; c <= productRange.end; c++) {
    const value = cellStr(ws, XLSX.utils.encode_cell({ r: row, c }));
    if (!value || isNonProductText(value)) continue;
    const key = compactText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ col: c, value });
  }

  if (candidates.length === 0) {
    return { productName: null, makerName: null, productCol: null };
  }

  const makerCandidate = candidates.length > 1
    ? candidates.find((c) => stats.likelyMakerCols.has(c.col)) ?? null
    : null;
  const productCandidates = candidates.filter((c) => c !== makerCandidate);
  const targetCandidates = productCandidates.length > 0 ? productCandidates : candidates;
  const product = [...targetCandidates].sort(
    (a, b) =>
      productNameScore(b, stats, candidates.length > 1) -
        productNameScore(a, stats, candidates.length > 1) ||
      a.col - b.col,
  )[0];

  return {
    productName: product ? cleanProductName(product.value) : null,
    productCol: product?.col ?? null,
    makerName:
      makerCandidate && product && compactText(makerCandidate.value) !== compactText(product.value)
        ? makerCandidate.value
        : null,
  };
}

function extractJanFromText(text: string | null): string | null {
  if (!text) return null;
  const m = text.normalize('NFKC').match(/JAN\s*[:：]?\s*([0-9\-\s]{8,18})/i);
  return normalizeJanCode(m?.[1] ?? null);
}

function extractIrisuFromInfo(text: string): string | null {
  const normalized = text.normalize('NFKC');
  const m = normalized.match(/入数\s*[:：]?\s*([^　\s]+(?:[　\s]*[×xX✕*＊][^　\s]+)*)/u);
  return m?.[1]?.trim() ?? null;
}

function extractShelfFromInfo(text: string): string | null {
  const normalized = text.normalize('NFKC');
  const m = normalized.match(/賞味\s*[:：]?\s*([0-9]+(?:日|ヶ月|カ月|か月|ヵ月|ケ月|月|年)?)/u);
  return m?.[1] ?? null;
}

function splitRetailPrefix(productName: string): {
  productName: string;
  retailPrice: number | null;
} {
  const normalized = productName.normalize('NFKC').trim();
  const cleanCatalogName = (s: string) => cleanProductName(s).replace(/\s{2,}/g, ' ');
  const m = normalized.match(/^([0-9]+)\s*円\s*(.+)$/u);
  if (!m) return { productName: cleanCatalogName(normalized), retailPrice: null };
  return { productName: cleanCatalogName(m[2]), retailPrice: parseLooseNumber(m[1]) };
}

function extractCatalogProducts(ws: XLSX.WorkSheet): RawProductRow[] {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  const products: RawProductRow[] = [];
  const seen = new Set<string>();

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const jan = extractJanFromText(cellStr(ws, XLSX.utils.encode_cell({ r, c })));
      if (!jan) continue;

      let rawName: string | null = null;
      const infoParts: string[] = [];
      for (let rr = r + 1; rr <= Math.min(range.e.r, r + 4); rr++) {
        const value = cellStr(ws, XLSX.utils.encode_cell({ r: rr, c }));
        if (!value) continue;
        infoParts.push(value);
        if (
          rawName === null &&
          !extractJanFromText(value) &&
          !/入数|賞味/.test(value) &&
          !isNonProductText(value)
        ) {
          rawName = value;
        }
      }

      if (!rawName) continue;
      const retailAndName = splitRetailPrefix(rawName);
      if (!retailAndName.productName || isNonProductText(retailAndName.productName)) continue;

      const seenKey = `${jan}:${compactText(retailAndName.productName)}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const infoText = infoParts.join(' ');
      const product = normalizeRawProduct({
        no: null,
        maker_name: null,
        product_name: retailAndName.productName,
        spec_raw: null,
        irisu_raw: extractIrisuFromInfo(infoText),
        min_lot_raw: null,
        retail_price: retailAndName.retailPrice,
        cost: null,
        jan_code: jan,
        shelf_life_raw: extractShelfFromInfo(infoText),
        sales_period_raw: null,
        note: null,
      });
      product.source_row = r;
      product.source_col = c;
      products.push(product);
    }
  }

  return products;
}

// 1シート分を処理してRawSheetDataを返す
function extractSheet(ws: XLSX.WorkSheet, sheetName: string): RawSheetData {
  const detected = detectHeaderRow(ws);
  if (!detected) {
    return { sheet_name: sheetName, maker_name: null, products: extractCatalogProducts(ws) };
  }

  const { headerRow, colMap, colRanges } = detected;
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  const products: RawProductRow[] = [];
  let sheetMakerName: string | null = null;
  let lastMakerName: string | null = null;
  const productNameRange =
    (colRanges as Record<string, { start: number; end: number } | undefined>).product_name ??
    (() => {
      const c = (colMap as Record<string, number | undefined>).product_name;
      return c === undefined ? null : { start: c, end: c };
    })();
  const productNameStats = productNameRange
    ? analyzeProductNameRange(ws, headerRow, productNameRange, range)
    : { likelyMakerCols: new Set<number>() };

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
    const productIdentity = productNameRange
      ? extractProductIdentity(ws, r, productNameRange, productNameStats)
      : {
          productName: get('product_name'),
          makerName: null,
          productCol: (colMap as Record<string, number | undefined>).product_name ?? null,
        };
    const productName = productIdentity.productName;
    if (!productName || isNonProductText(productName)) {
      emptyStreak++;
      if (products.length > 0 && emptyStreak >= 3) break;
      continue;
    }
    emptyStreak = 0;

    // メーカー名（シート内で最初に見つかったものをシートのmaker_nameとして使う）
    const explicitMakerName: string | null = get('maker_name') ?? productIdentity.makerName;
    if (explicitMakerName) lastMakerName = explicitMakerName;
    const makerName: string | null = explicitMakerName ?? lastMakerName ?? sheetMakerName;
    if (makerName && !sheetMakerName) sheetMakerName = makerName;

    const product = normalizeRawProduct({
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
    });
    product.source_row = r;
    product.source_col = productIdentity.productCol;
    products.push(product);
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
