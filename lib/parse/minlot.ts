/**
 * 最小ロットパーサ (仕様書 v2.1 §5.2)
 *
 * 表記: "N甲" / "Nケース" / "1ケース" / "Nピース"
 * 全角/半角・誤記（ケーズ等）を正規表現＋エイリアス辞書で吸収。
 * min_lot_qty（個）= §5.2 の表に従い算出。
 */

export type MinLotResult = {
  qty: number;
  parseError: boolean;
};

// 単位エイリアス辞書（キー: 正規化後の単位, 値: 正規表現パターン）
const UNIT_ALIASES: Record<string, RegExp> = {
  kou: /甲|こう|コウ/u,
  case: /ケース|ケーズ|ケース|けーす|ｹｰｽ|case|CASE|Case|cs|CS|ＣＳ/u,
  piece: /ピース|ﾋﾟｰｽ|個|piece|PIECE|Piece|pcs|PCS/u,
};

export function parseMinLot(
  raw: string | null | undefined,
  caseQty: number,
  lotsPerKou: number,
): MinLotResult {
  if (!raw || raw.trim() === '') {
    return { qty: 0, parseError: true };
  }

  const normalized = raw.normalize('NFKC').trim().replace(/\s/g, '');

  // 数値部分を取得（"混載10cs～" のような前置き付きにも対応）
  const digitNorm = normalized.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  const numMatch = digitNorm.match(/(\d+(?:\.\d+)?)/);
  const n = numMatch ? parseFloat(numMatch[1]) : 1;

  // 単位判定
  if (UNIT_ALIASES.kou.test(normalized)) {
    // N甲: N × caseQty × lotsPerKou
    const qty = Math.round(n) * caseQty * lotsPerKou;
    return { qty, parseError: false };
  }

  if (UNIT_ALIASES.case.test(normalized)) {
    // Nケース: N × caseQty
    const qty = Math.round(n) * caseQty;
    return { qty, parseError: false };
  }

  if (UNIT_ALIASES.piece.test(normalized)) {
    // Nピース/個: N
    return { qty: Math.round(n), parseError: false };
  }

  // 単位が不明だが数値だけある場合はケースとして扱う（保守的）
  if (numMatch) {
    return { qty: Math.round(n) * caseQty, parseError: true };
  }

  return { qty: 0, parseError: true };
}
