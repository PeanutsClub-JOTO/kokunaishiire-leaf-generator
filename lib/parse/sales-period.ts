/**
 * 販売期間パーサ (仕様書 v2.1 §5.2)
 *
 * 形式: "YYYY.MM.DD〜YYYY.MM.DD"
 * 区切り文字: 〜/~/- を正規化
 * 未記載・空欄 → { start: null, end: null }（制限なし＝通過）
 */

export type SalesPeriodResult = {
  start: Date | null;
  end: Date | null;
  parseError: boolean;
};

// 日付文字列 "YYYY.MM.DD" / "YYYY/MM/DD" / "YYYY-MM-DD" をパース
function parseDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$|^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year  = parseInt(m[1] ?? m[4], 10);
  const month = parseInt(m[2] ?? m[5], 10) - 1; // 0-indexed
  const day   = parseInt(m[3] ?? m[6], 10);
  const d = new Date(year, month, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

// 日付パターン: YYYY.MM.DD または YYYY/MM/DD または YYYY-MM-DD
const DATE_PAT = String.raw`\d{4}[./\-]\d{1,2}[./\-]\d{1,2}`;
// 範囲セパレータ: 全角チルダ/半角チルダ/全角ダッシュ
// ハイフン区切り ("2026.04.17-2026.07.31") は以下の正規表現でまとめてキャプチャ
const RANGE_RE = new RegExp(
  `^(${DATE_PAT})[〜~～－-](${DATE_PAT})$`,
  'u',
);

export function parseSalesPeriod(
  raw: string | null | undefined,
): SalesPeriodResult {
  if (!raw || raw.trim() === '' || raw === '-' || raw === '—') {
    return { start: null, end: null, parseError: false };
  }

  const normalized = raw.trim().replace(/\s/g, '');

  const m = normalized.match(RANGE_RE);
  if (!m) {
    return { start: null, end: null, parseError: true };
  }

  const start = parseDate(m[1]);
  const end   = parseDate(m[2]);

  if (!start || !end) {
    return { start: null, end: null, parseError: true };
  }

  return { start, end, parseError: false };
}

/**
 * 賞味期限残日数パーサ
 * "240日（240日）" / "90日" など先頭の数値を残日数として抽出
 */
export function parseShelfLife(raw: string | null | undefined): {
  days: number;
  parseError: boolean;
} {
  if (!raw || raw.trim() === '') {
    return { days: 0, parseError: true };
  }

  // 全角数字を半角に
  const normalized = raw.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  const m = normalized.match(/^(\d+)/);
  if (!m) {
    return { days: 0, parseError: true };
  }

  return { days: parseInt(m[1], 10), parseError: false };
}
