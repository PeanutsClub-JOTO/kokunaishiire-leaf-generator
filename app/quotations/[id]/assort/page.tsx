/**
 * 画面③ — アソート構成
 * グループごとにアソート品・比率・計算結果を表示する
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/client';
import AssortGroupEditor from '@/components/AssortGroupEditor';

const FAIL_FLAGS = new Set(['cost_over', 'unit_price>cap', 'shelf<min', 'sales_out_of_range']);

type PageProps = { params: Promise<{ id: string }> };

type AssortItemRow = {
  id: string;
  ratio: number;
  products: {
    id: string;
    no: number | null;
    product_name: string | null;
    cost: number | null;
    min_lot_qty: number | null;
  } | null;
};

type LeafletRow = {
  id: string;
  status: 'draft' | 'final';
  leaf_name: string | null;
  leaf_qty: number | null;
  cost_total: number | null;
  wholesale_price: number | null;
  unit_price: number | null;
  is_half_ok: boolean | null;
  pdf_url: string | null;
};

export default async function AssortPage({ params }: PageProps) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data: quotation } = await supabase
    .from('quotations')
    .select('id, source_ref')
    .eq('id', id)
    .single();
  if (!quotation) notFound();

  const { data: sheets } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', id);
  const sheetIds = (sheets ?? []).map((s) => s.id);

  const { data: groups } = sheetIds.length > 0
    ? await supabase
        .from('assort_groups')
        .select(`
          id, group_key, is_single, sheet_id,
          assort_items(id, ratio, products(id, no, product_name, cost, min_lot_qty)),
          leaflets(id, status, leaf_name, leaf_qty, cost_total, wholesale_price, unit_price, is_half_ok, pdf_url)
        `)
        .in('sheet_id', sheetIds)
    : { data: [] };

  // alert_flags をグループ・リーフ単位で別取得
  const groupIds = (groups ?? []).map((g) => g.id);
  const leafletIds = (groups ?? []).flatMap((g) => {
    const arr = Array.isArray(g.leaflets) ? g.leaflets : [g.leaflets];
    return arr.filter(Boolean).map((l) => (l as LeafletRow).id);
  });

  const flagsByGroup = new Map<string, { flag_code: string; message: string | null }[]>();
  if (groupIds.length > 0) {
    const { data: gFlags } = await supabase
      .from('alert_flags')
      .select('target_id, flag_code, message')
      .eq('target_type', 'group')
      .in('target_id', groupIds);
    for (const f of gFlags ?? []) {
      const arr = flagsByGroup.get(f.target_id) ?? [];
      arr.push({ flag_code: f.flag_code, message: f.message });
      flagsByGroup.set(f.target_id, arr);
    }
  }
  if (leafletIds.length > 0) {
    const { data: lFlags } = await supabase
      .from('alert_flags')
      .select('target_id, flag_code, message')
      .eq('target_type', 'leaflet')
      .in('target_id', leafletIds);
    for (const f of lFlags ?? []) {
      const arr = flagsByGroup.get(f.target_id) ?? [];
      arr.push({ flag_code: f.flag_code, message: f.message });
      flagsByGroup.set(f.target_id, arr);
    }
  }

  const passGroups = (groups ?? []).filter(
    (g) => !(flagsByGroup.get(g.id) ?? []).some((f) => FAIL_FLAGS.has(f.flag_code)),
  );

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
          <Link href="/" className="hover:text-zinc-700 transition-colors">見積一覧</Link>
          <span className="text-zinc-300">/</span>
          <Link href={`/quotations/${id}/products`} className="hover:text-zinc-700 transition-colors">判定結果</Link>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-600 font-medium">アソート構成</span>
        </nav>
        <h1 className="text-lg font-bold text-zinc-900">アソート構成</h1>
        <p className="text-sm text-zinc-500 mt-1">
          全 <b className="text-zinc-800">{(groups ?? []).length}</b> グループ　通過 <b className="text-emerald-600">{passGroups.length}</b> グループ
        </p>
      </header>

      <main className="px-6 py-6 space-y-6">
        {(groups ?? []).length === 0 && (
          <div className="text-center py-16 text-zinc-400">
            <p>アソートグループがまだ作成されていません。</p>
          </div>
        )}

        {(groups ?? []).map((group) => {
          const leaflet = Array.isArray(group.leaflets)
            ? (group.leaflets[0] as LeafletRow | undefined)
            : (group.leaflets as LeafletRow | undefined);

          const groupFlags = flagsByGroup.get(group.id) ?? [];
          const leafletFlags = leaflet ? (flagsByGroup.get(leaflet.id) ?? []) : [];
          const allFlags = [...groupFlags, ...leafletFlags];
          const isFail = allFlags.some((f) => FAIL_FLAGS.has(f.flag_code));

          const items = (Array.isArray(group.assort_items)
            ? group.assort_items
            : [group.assort_items]) as AssortItemRow[];

          return (
            <div
              key={group.id}
              className={`bg-white rounded-xl border ${isFail ? 'border-red-200' : 'border-zinc-200'} overflow-hidden`}
            >
              <div className={`px-5 py-3 flex items-center justify-between ${isFail ? 'bg-red-50' : 'bg-zinc-50'} border-b ${isFail ? 'border-red-100' : 'border-zinc-200'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{isFail ? '❌' : '✅'}</span>
                  <div>
                    <div className="font-semibold text-zinc-800 text-sm">
                      {leaflet?.leaf_name ?? '（品名未設定）'}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {group.is_single ? '単品' : `アソート ${items.length}種`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {allFlags.map((f) => (
                    <span
                      key={f.flag_code}
                      className={`text-xs rounded px-2 py-0.5 font-medium ${
                        FAIL_FLAGS.has(f.flag_code) ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {f.flag_code}
                    </span>
                  ))}
                  {leaflet && (
                    <Link
                      href={`/quotations/${id}/leaflets`}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      リーフ編集 →
                    </Link>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <AssortGroupEditor
                  groupId={group.id}
                  items={items}
                  leaflet={leaflet ? {
                    id: leaflet.id,
                    leaf_qty: leaflet.leaf_qty,
                    wholesale_price: leaflet.wholesale_price,
                    unit_price: leaflet.unit_price,
                    is_half_ok: leaflet.is_half_ok,
                  } : null}
                />
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
