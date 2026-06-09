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

// 全角×/半角x/特殊✕ を正規化するパターン
const SEPARATOR_RE = /[×xX✕×]/u;

export function parseIrisu(raw: string | null | undefined): IrisuResult {
  if (!raw || raw.trim() === '') {
    return { caseQty: 0, lotsPerKou: 1, parseError: true };
  }

  const normalized = raw.trim().replace(/\s/g, '');

  // セパレータで分割
  const parts = normalized.split(SEPARATOR_RE);

  const a = parseInt(parts[0], 10);
  if (isNaN(a) || a <= 0) {
    return { caseQty: 0, lotsPerKou: 1, parseError: true };
  }

  if (parts.length === 1) {
    // "12" 形式 → ケース入数のみ、甲なし
    return { caseQty: a, lotsPerKou: 1, parseError: false };
  }

  const b = parseInt(parts[1], 10);
  if (isNaN(b) || b <= 0) {
    return { caseQty: a, lotsPerKou: 1, parseError: true };
  }

  return { caseQty: a, lotsPerKou: b, parseError: false };
}
