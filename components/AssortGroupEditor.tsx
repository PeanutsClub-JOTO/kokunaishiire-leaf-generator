'use client';
import { useState } from 'react';

type Product = {
  id: string;
  no: number | null;
  product_name: string | null;
  cost: number | null;
  min_lot_qty: number | null;
};

type AssortItem = {
  id: string;
  ratio: number;
  products: Product | null;
};

type Leaflet = {
  id: string;
  leaf_qty: number | null;
  wholesale_price: number | null;
  unit_price: number | null;
  is_half_ok: boolean | null;
};

type Props = {
  groupId: string;
  items: AssortItem[];
  leaflet: Leaflet | null;
  compact?: boolean;
};

export default function AssortGroupEditor({ groupId, items, leaflet, compact = false }: Props) {
  const [ratios, setRatios] = useState<Record<string, number>>(
    Object.fromEntries(items.map((i) => [i.id, i.ratio])),
  );
  const [result, setResult] = useState<{
    leafQty: number;
    wholesale: number;
    unitPrice: number;
    isHalfOk: boolean;
    ok: boolean;
    reason?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleRecalc() {
    setSaving(true);
    setError('');
    try {
      const ratioList = items.map((i) => ({
        product_id: i.products?.id ?? '',
        ratio: ratios[i.id] ?? i.ratio,
      }));

      const res = await fetch(`/api/assort/${groupId}/recalc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratios: ratioList }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '再計算エラー'); return; }
      setResult(data.result);
    } catch (err: any) {
      setError(err.message ?? '通信エラー');
    } finally {
      setSaving(false);
    }
  }

  const display = result ?? {
    leafQty: leaflet?.leaf_qty ?? 0,
    wholesale: leaflet?.wholesale_price ?? 0,
    unitPrice: leaflet?.unit_price ?? 0,
    isHalfOk: leaflet?.is_half_ok ?? false,
    ok: true,
  };

  return (
    <div className="space-y-3">
      {compact ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="text-xs">
              <div className="flex justify-between text-zinc-600 mb-1">
                <span className="truncate pr-2">{item.products?.product_name ?? '—'}</span>
                <span className="font-semibold w-6 text-right">×{ratios[item.id] ?? item.ratio}</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={ratios[item.id] ?? item.ratio}
                onChange={(e) =>
                  setRatios((prev) => ({ ...prev, [item.id]: parseInt(e.target.value, 10) || 1 }))
                }
                className="w-full h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-zinc-100">
              <th className="pb-1 font-medium">No.</th>
              <th className="pb-1 font-medium">品名</th>
              <th className="pb-1 font-medium">原価</th>
              <th className="pb-1 font-medium">最小ロット</th>
              <th className="pb-1 font-medium">比率</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-50">
                <td className="py-1.5 text-zinc-500">{item.products?.no ?? '—'}</td>
                <td className="py-1.5 text-zinc-800">{item.products?.product_name ?? '—'}</td>
                <td className="py-1.5 text-zinc-600">¥{item.products?.cost?.toLocaleString() ?? '—'}</td>
                <td className="py-1.5 text-zinc-600">{item.products?.min_lot_qty ?? '—'}</td>
                <td className="py-1.5">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={ratios[item.id] ?? item.ratio}
                    onChange={(e) =>
                      setRatios((prev) => ({ ...prev, [item.id]: parseInt(e.target.value, 10) || 1 }))
                    }
                    className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-center text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={handleRecalc}
          disabled={saving}
          className={`px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 ${compact ? 'w-full' : ''}`}
        >
          {saving ? '再計算中...' : '比率変更 & 再計算'}
        </button>
      </div>
      {error && <div className="text-red-600 text-xs">{error}</div>}

      {/* 計算結果サマリ */}
      <div className={`grid gap-2 text-sm ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 border border-zinc-100">
          <div className="text-[10px] text-zinc-500">入数</div>
          <div className="font-semibold text-xs">{display.leafQty}個</div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 border border-zinc-100">
          <div className="text-[10px] text-zinc-500">卸価格</div>
          <div className="font-semibold text-xs">¥{Math.round(display.wholesale).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 border border-zinc-100">
          <div className="text-[10px] text-zinc-500">単価</div>
          <div className={`font-semibold text-xs ${display.unitPrice > 1000 ? 'text-red-600' : ''}`}>
            ¥{display.unitPrice.toFixed(1)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 border border-zinc-100">
          <div className="text-[10px] text-zinc-500">ハーフ</div>
          <div className="font-semibold text-xs">{display.isHalfOk ? '○' : '×'}</div>
        </div>
      </div>

      {result && !result.ok && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 border border-red-100">
          × {result.reason}
        </div>
      )}
    </div>
  );
}
