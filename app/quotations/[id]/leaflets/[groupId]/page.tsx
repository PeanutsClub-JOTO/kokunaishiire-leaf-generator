import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/client';
import AssortGroupEditor from '@/components/AssortGroupEditor';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string; groupId: string }> };

export default async function LeafletWorkbenchPage({ params }: PageProps) {
  const { id, groupId } = await params;
  const supabase = createServerClient();

  // Fetch the quotation for breadcrumbs
  const { data: quotation } = await supabase
    .from('quotations')
    .select('id, client_name')
    .eq('id', id)
    .single();

  if (!quotation) notFound();

  // Fetch all groups in this quotation to show in the left sidebar
  const { data: sheets } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', id);
  const sheetIds = (sheets ?? []).map((s) => s.id);

  const { data: allGroups } = sheetIds.length > 0
    ? await supabase
        .from('assort_groups')
        .select(`
          id, is_single,
          leaflets (id, leaf_name, unit_price, status, leaf_image_url)
        `)
        .in('sheet_id', sheetIds)
    : { data: [] };

  // Fetch the active group details
  const { data: activeGroup } = await supabase
    .from('assort_groups')
    .select(`
      id, is_single,
      assort_items (id, ratio, products (id, no, product_name, cost, min_lot_qty)),
      leaflets (id, leaf_name, leaf_qty, cost_total, wholesale_price, unit_price, is_half_ok, lead_time, note, leaf_image_url)
    `)
    .eq('id', groupId)
    .single();

  if (!activeGroup) notFound();

  const activeLeaflet = Array.isArray(activeGroup.leaflets)
    ? activeGroup.leaflets[0]
    : activeGroup.leaflets;

  const items = (Array.isArray(activeGroup.assort_items)
    ? activeGroup.assort_items
    : [activeGroup.assort_items]) as any[];

  return (
    <div className="flex flex-col h-screen bg-zinc-50 overflow-hidden text-zinc-900">
      {/* Header */}
      <header className="flex-none bg-white border-b border-zinc-200 px-6 py-3.5">
        <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-1">
          <Link href="/" className="hover:text-zinc-700 transition-colors">見積一覧</Link>
          <span className="text-zinc-300">/</span>
          <Link href={`/quotations/${id}/products`} className="hover:text-zinc-700 transition-colors">判定結果</Link>
          <span className="text-zinc-300">/</span>
          <Link href={`/quotations/${id}/assort`} className="hover:text-zinc-700 transition-colors">アソート構成</Link>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-600 font-medium">リーフ編集</span>
        </nav>
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-zinc-900">リーフ ワークベンチ</h1>
          <div className="text-xs text-zinc-500">
            {quotation.client_name ?? '顧客名未設定'} ／ 全 {allGroups?.length ?? 0} リーフ
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Aside (Gallery) */}
        <aside className="w-64 flex-none bg-zinc-50 border-r border-zinc-200 p-3 overflow-y-auto hidden md:block">
          <div className="space-y-2">
            {(allGroups ?? []).map((g) => {
              const l = Array.isArray(g.leaflets) ? g.leaflets[0] : g.leaflets;
              const isActive = g.id === groupId;
              return (
                <Link
                  key={g.id}
                  href={`/quotations/${id}/leaflets/${g.id}`}
                  className={`block w-full text-left bg-white border rounded-lg p-2 cursor-pointer transition-shadow hover:shadow-sm ${
                    isActive ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-zinc-200'
                  }`}
                >
                  <div className="aspect-[16/10] bg-zinc-100 rounded flex items-center justify-center overflow-hidden mb-2">
                    {l?.leaf_image_url ? (
                      <img src={l.leaf_image_url} alt="leaflet" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-zinc-400 text-xs">画像未生成</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-zinc-800 truncate">
                    {l?.leaf_name || '（品名未設定）'}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-zinc-500">
                    <span className={`px-1 py-0.5 rounded ${g.is_single ? 'bg-zinc-100' : 'bg-amber-100 text-amber-700'}`}>
                      {g.is_single ? '単品' : 'アソート'}
                    </span>
                    <span>単価 ¥{l?.unit_price ? Math.round(l.unit_price) : '—'}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Main Preview Area */}
        <main className="flex-1 bg-zinc-100 p-6 flex flex-col items-center overflow-y-auto">
          <div className="w-full max-w-3xl bg-white aspect-[1/1.414] shadow-lg flex items-center justify-center overflow-hidden relative">
            {activeLeaflet?.leaf_image_url ? (
              <img src={activeLeaflet.leaf_image_url} alt="Preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-2">📄</div>
                <div className="text-sm text-zinc-400">画像はまだ生成されていません</div>
                <div className="text-xs text-zinc-400 mt-1">右側の「リーフ画像を生成」をクリックしてください</div>
              </div>
            )}
          </div>
          <div className="mt-4 text-xs text-zinc-500">
            ↑ 左で選択した内容をプレビューします。テキストや比率を変更して生成ボタンを押すと反映されます。
          </div>
        </main>

        {/* Right Aside (Editor) */}
        <aside className="w-80 flex-none bg-white border-l border-zinc-200 p-4 overflow-y-auto flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">掲載品名</label>
            <textarea
              className="w-full border border-zinc-300 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
              rows={2}
              defaultValue={activeLeaflet?.leaf_name ?? ''}
              placeholder="例：涼ごこち福岡県産あまおう苺・山梨県産白桃"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">セールスコピー（空欄なら自動生成）</label>
            <textarea
              className="w-full border border-zinc-300 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
              rows={3}
              defaultValue={activeLeaflet?.note ?? ''}
              placeholder="あまおう苺・白桃・夕張メロンの3種アソートです。"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-zinc-500 mb-1">受注後納期</label>
            <input
              type="text"
              className="w-full border border-zinc-300 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              defaultValue={activeLeaflet?.lead_time ?? '受注後約1週間'}
            />
          </div>

          <div className="mt-2">
            <h4 className="text-[11px] font-semibold text-zinc-500 mb-2">アソート比率 & サイジング</h4>
            {/* TODO: Create a specialized slider UI or adapt AssortGroupEditor */}
            <div className="-mx-4 border-y border-zinc-100 bg-zinc-50/50 p-4">
              <AssortGroupEditor
                groupId={groupId}
                items={items}
                leaflet={activeLeaflet}
                compact={true}
              />
            </div>
          </div>

          <div className="mt-auto space-y-2 pt-4">
            <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors shadow-sm">
              保存（テキスト・情報）
            </button>
            <button className="w-full rounded-lg bg-white border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors">
              リーフ画像を生成
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
