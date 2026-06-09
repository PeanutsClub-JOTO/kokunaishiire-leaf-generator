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
};

export default function AssortGroupEditor({ groupId, items, leaflet }: Props) {
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

      <div className="flex items-center gap-4">
        <button
          onClick={handleRecalc}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? '再計算中...' : '比率変更 & 再計算'}
        </button>
        {error && <span className="text-red-600 text-xs">{error}</span>}
      </div>

      {/* 計算結果サマリ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-sm">
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <div className="text-xs text-zinc-500">入数</div>
          <div className="font-semibold">{display.leafQty}個</div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <div className="text-xs text-zinc-500">卸価格</div>
          <div className="font-semibold">¥{Math.round(display.wholesale).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <div className="text-xs text-zinc-500">単価</div>
          <div className={`font-semibold ${display.unitPrice > 1000 ? 'text-red-600' : ''}`}>
            ¥{display.unitPrice.toFixed(1)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2">
          <div className="text-xs text-zinc-500">ハーフ</div>
          <div className="font-semibold">{display.isHalfOk ? '○' : '×'}</div>
        </div>
      </div>

      {result && !result.ok && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          × {result.reason}
        </div>
      )}
    </div>
  );
}
