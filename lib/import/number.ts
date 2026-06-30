export function parseLooseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;

  const normalized = String(value)
    .normalize('NFKC')
    .replace(/[,\s￥¥円税込税別]/g, '');

  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
