/**
 * 入数パーサ (仕様書 v2.1 §5.2)
 *
 * "A×B" 形式で「ケース入数 × 甲あたりケース数」を表す。
 * 区切り文字 ×/x/✕ の揺れを正規化。
 * B が無ければ lotsPerKou=1（甲なし＝ケース止まり）。
 */

export type IrisuResult = {
  caseQty: number;
  lotsPerKou: number;
  parseError: boolean;
};

// 全角×/半角x/特殊✕/アスタリスクを正規化するパターン
const SEPARATOR_RE = /[×xX✕*＊]/u;

export function parseIrisu(raw: string | null | undefined): IrisuResult {
  if (!raw || raw.trim() === '') {
    return { caseQty: 0, lotsPerKou: 1, parseError: true };
  }

  const normalized = raw.normalize('NFKC').trim().replace(/\s/g, '');

  const firstNumber = normalized.match(/\d+/);
  if (!firstNumber) {
    return { caseQty: 0, lotsPerKou: 1, parseError: true };
  }

  const a = parseInt(firstNumber[0], 10);
  if (isNaN(a) || a <= 0) {
    return { caseQty: 0, lotsPerKou: 1, parseError: true };
  }

  // "60(5×12)" のように先頭に総入数があり、括弧内に内訳がある場合は総入数を優先する。
  if (/^\d+[（(]/.test(normalized)) {
    return { caseQty: a, lotsPerKou: 1, parseError: false };
  }

  // セパレータで分割
  const parts = normalized.split(SEPARATOR_RE);

  if (parts.length === 1) {
    // "12" 形式 → ケース入数のみ、甲なし
    return { caseQty: a, lotsPerKou: 1, parseError: false };
  }

  const rest = parts.slice(1).map((part) => parseInt(part, 10));
  if (rest.some((n) => isNaN(n) || n <= 0)) {
    return { caseQty: a, lotsPerKou: 1, parseError: true };
  }

  return {
    caseQty: a,
    lotsPerKou: rest.reduce((acc, n) => acc * n, 1),
    parseError: false,
  };
}
