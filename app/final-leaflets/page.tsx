/**
 * 確定リーフ一覧
 *
 * 企画確定後、final_visible_until まで（既定3日）表示する確認画面。
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/client';

function statusLabel(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    none: { label: '未転送', cls: 'bg-zinc-100 text-zinc-600' },
    pending: { label: 'Drive転送待ち', cls: 'bg-indigo-100 text-indigo-700' },
    exporting: { label: 'Drive転送中', cls: 'bg-indigo-100 text-indigo-700' },
    done: { label: 'Drive転送済み', cls: 'bg-emerald-100 text-emerald-700' },
    error: { label: 'Drive転送エラー', cls: 'bg-red-100 text-red-600' },
  };
  const item = map[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-600' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.cls}`}>{item.label}</span>;
}

export default async function FinalLeafletsPage() {
  const supabase = createServerClient();
  const now = new Date().toISOString();
  const { data: leaflets } = await supabase
    .from('leaflets')
    .select(`
      id, leaf_name, leaf_qty, wholesale_price, unit_price, leaf_image_url,
      finalized_at, final_visible_until, drive_url, drive_export_status, drive_export_error,
      assort_followup_status,
      assort_groups(id, sheet_id, is_single, sheets(id, quotation_id, maker_name, quotations(id, client_name, source_ref)))
    `)
    .eq('status', 'final')
    .gte('final_visible_until', now)
    .order('finalized_at', { ascending: false });

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <nav className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
              <Link href="/" className="hover:text-zinc-700">見積一覧</Link>
              <span>/</span>
              <span className="font-medium text-zinc-600">確定リーフ</span>
            </nav>
            <h1 className="text-lg font-bold text-zinc-900">確定リーフ</h1>
            <p className="mt-0.5 text-xs text-zinc-500">確定後3日間だけ表示されます</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {!leaflets || leaflets.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center">
            <p className="text-sm text-zinc-400">現在表示中の確定リーフはありません</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leaflets.map((leaflet) => {
              const group = Array.isArray(leaflet.assort_groups) ? leaflet.assort_groups[0] : leaflet.assort_groups;
              const sheet = Array.isArray(group?.sheets) ? group?.sheets[0] : group?.sheets;
              const quotation = Array.isArray(sheet?.quotations) ? sheet?.quotations[0] : sheet?.quotations;
              return (
                <article key={leaflet.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                  <div className="aspect-[16/10] bg-zinc-100">
                    {leaflet.leaf_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={leaflet.leaf_image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-zinc-400">画像なし</div>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        {statusLabel(leaflet.drive_export_status ?? 'none')}
                        <span className="text-xs text-zinc-400">
                          {group?.is_single ? '単品' : 'アソート'}
                        </span>
                      </div>
                      <h2 className="line-clamp-2 text-sm font-bold text-zinc-900">{leaflet.leaf_name}</h2>
                      <p className="mt-1 text-xs text-zinc-400">
                        {quotation?.client_name ?? ''} {sheet?.maker_name ? `／ ${sheet.maker_name}` : ''}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-2 text-center text-xs">
                      <div>
                        <div className="text-zinc-400">入数</div>
                        <div className="font-semibold text-zinc-800">{leaflet.leaf_qty ?? '—'}</div>
                      </div>
                      <div>
                        <div className="text-zinc-400">卸価格</div>
                        <div className="font-semibold text-zinc-800">{Math.round(Number(leaflet.wholesale_price ?? 0)).toLocaleString('ja-JP')}</div>
                      </div>
                      <div>
                        <div className="text-zinc-400">単価</div>
                        <div className="font-semibold text-zinc-800">{Math.round(Number(leaflet.unit_price ?? 0)).toLocaleString('ja-JP')}</div>
                      </div>
                    </div>
                    {leaflet.drive_export_error && (
                      <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">{leaflet.drive_export_error}</p>
                    )}
                    <div className="flex items-center gap-2">
                      {leaflet.drive_url && (
                        <a
                          href={leaflet.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Driveで開く
                        </a>
                      )}
                      {quotation?.id && (
                        <Link
                          href={`/quotations/${quotation.id}/leaflets`}
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                        >
                          編集画面へ
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
