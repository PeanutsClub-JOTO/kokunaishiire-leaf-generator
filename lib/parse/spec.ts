/**
 * 規格パーサ (仕様書 v2.1 §5.2)
 *
 * 規格は「個数」または「内容量(g)」のどちらも入りうる。
 * - 末尾が「個」→ specPieces = 整数部、specGrams = null
 * - 末尾が「g」→ specGrams = 数値、specPieces = null
 * - 両方含む場合は両方取得
 * - spec_raw は常に保持（呼び出し側で保持すること）
 *
 * アソート主判定の「規格一致」は specPieces 同士、または specGrams 同士で比較。
 * 型が違えば不一致扱い。
 */

export type SpecResult = {
  specPieces: number | null;
  specGrams: number | null;
  parseError: boolean;
};

// 全角数字を半角に正規化
function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

// 全角アルファベット・単位を半角に正規化
function normalizeUnit(s: string): string {
  return s
    .replace(/Ｇ|ｇ/g, 'g')
    .replace(/個|ｺ|コ/g, '個')
    .replace(/\s/g, '');
}

export function parseSpec(raw: string | null | undefined): SpecResult {
  if (!raw || raw.trim() === '') {
    return { specPieces: null, specGrams: null, parseError: true };
  }

  const s = normalizeUnit(normalizeDigits(raw.trim()));

  let specPieces: number | null = null;
  let specGrams: number | null = null;
  let matched = false;

  // 個数パターン: 数値 + 個/ｺ/コ
  const piecesMatch = s.match(/(\d+(?:\.\d+)?)個/);
  if (piecesMatch) {
    specPieces = parseInt(piecesMatch[1], 10);
    matched = true;
  }

  // グラムパターン: 数値 + g/G（大文字も含む）
  const gramsMatch = s.match(/(\d+(?:\.\d+)?)[gG]/);
  if (gramsMatch) {
    specGrams = parseFloat(gramsMatch[1]);
    matched = true;
  }

  if (!matched) {
    return { specPieces: null, specGrams: null, parseError: true };
  }

  return { specPieces, specGrams, parseError: false };
}

/**
 * アソート主判定用の規格一致チェック
 * specPieces 同士、または specGrams 同士でのみ一致とみなす。
 */
export function specMatches(a: SpecResult, b: SpecResult): boolean {
  if (a.parseError || b.parseError) return false;

  if (a.specPieces !== null && b.specPieces !== null) {
    return a.specPieces === b.specPieces;
  }
  if (a.specGrams !== null && b.specGrams !== null) {
    return a.specGrams === b.specGrams;
  }
  // 型が違う（片方がpieces、片方がgrams）→ 不一致
  return false;
}
