/**
 * 画面④ — リーフプレビュー & 確定
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/client';
import LeafletFinalizeForm from '@/components/LeafletFinalizeForm';

type PageProps = { params: Promise<{ id: string; groupId: string }> };

function fmt(n: number | null, unit = '') {
  if (n == null) return '—';
  return `${n.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}${unit}`;
}

export default async function LeafletPage({ params }: PageProps) {
  const supabase = createServerClient();
  const { id, groupId } = await params;

  // アソートグループ + アイテム + リーフ（alert_flagsは別途）
  const { data: group } = await supabase
    .from('assort_groups')
    .select(`
      id, is_single, sheet_id,
      assort_items(ratio, products(id, product_name, maker_name, spec_raw, image_url, jan_code, piece_size, shelf_life_days, cost, min_lot_qty)),
      leaflets(id, status, leaf_name, product_code, pj_no, item_count, leaf_qty, cost_total, wholesale_price, unit_price, is_half_ok, lead_time, shelf_life_days, pdf_url, leaf_image_url, render_status, render_error)
    `)
    .eq('id', groupId)
    .single();
  if (!group) notFound();

  type LeafletRow = {
    id: string; status: 'draft' | 'final'; leaf_name: string | null;
    product_code: string | null; pj_no: string | null; item_count: number | null;
    leaf_qty: number | null; cost_total: number | null; wholesale_price: number | null;
    unit_price: number | null; is_half_ok: boolean | null; lead_time: string | null;
    shelf_life_days: number | null; pdf_url: string | null;
    leaf_image_url: string | null; render_status: string | null; render_error: string | null;
  };

  type AssortItemRow = {
    ratio: number;
    products: {
      id: string; product_name: string | null; maker_name: string | null;
      spec_raw: string | null; image_url: string | null; jan_code: string | null;
      piece_size: string | null; shelf_life_days: number | null;
      cost: number | null; min_lot_qty: number | null;
    } | null;
  };

  const leaflet = (Array.isArray(group.leaflets) ? group.leaflets[0] : group.leaflets) as LeafletRow | undefined;
  if (!leaflet) notFound();

  const items = (Array.isArray(group.assort_items)
    ? group.assort_items
    : [group.assort_items]) as AssortItemRow[];

  // alert_flags を別途取得
  const { data: rawFlags } = await supabase
    .from('alert_flags')
    .select('flag_code, message')
    .eq('target_type', 'leaflet')
    .eq('target_id', leaflet.id);
  const alertFlags = rawFlags ?? [];

  const firstProduct = items[0]?.products;
  const imageUrl = firstProduct?.image_url ?? null;
  const isDraft = leaflet.status === 'draft';

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href="/" className="hover:text-zinc-800">見積一覧</Link>
          <span>/</span>
          <Link href={`/quotations/${id}/assort`} className="hover:text-zinc-800">アソート</Link>
          <span>/</span>
          <span className="text-zinc-800 font-medium">リーフ詳細</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-zinc-900">
            {leaflet.leaf_name ?? '（品名未設定）'}
          </h1>
          {isDraft ? (
            <span className="rounded-full bg-amber-100 text-amber-700 text-xs px-2 py-0.5 font-medium">仮リーフ</span>
          ) : (
            <span className="rounded-full bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 font-medium">正式</span>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* 左: リーフ情報 */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-zinc-600">リーフ掲載情報</h2>

            <div className="flex justify-center bg-zinc-50 rounded-xl border border-zinc-200 p-6">
              {leaflet.leaf_image_url ? (
                <Image src={leaflet.leaf_image_url} alt="生成リーフ画像" width={520} height={328} className="w-full max-w-[520px] rounded-lg border border-zinc-200 object-contain" unoptimized />
              ) : imageUrl ? (
                <Image src={imageUrl} alt="商品画像" width={180} height={180} className="object-contain" unoptimized />
              ) : (
                <div className="w-[180px] h-[180px] flex items-center justify-center text-zinc-300 text-sm">画像なし</div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-zinc-100">
                  {[
                    ['アイテム数',   `${leaflet.item_count ?? 1}種`],
                    ['入数',         `${leaflet.leaf_qty ?? '—'}個`],
                    ['仕入原価合計', fmt(leaflet.cost_total, '円')],
                    ['卸価格',       fmt(leaflet.wholesale_price, '円')],
                    ['1個単価',      fmt(leaflet.unit_price, '円')],
                    ['ハーフ可否',   leaflet.is_half_ok ? '○' : '×'],
                    ['商品サイズ',   firstProduct?.piece_size ?? '—'],
                    ['賞味期限',     leaflet.shelf_life_days != null ? `${leaflet.shelf_life_days}日` : '—'],
                    ['JANコード',    firstProduct?.jan_code ?? '—'],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs w-36">{label}</td>
                      <td className="px-4 py-2.5 text-zinc-800 font-medium">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!group.is_single && (
              <div>
                <h3 className="text-xs font-semibold text-zinc-500 mb-2">アソート内訳</h3>
                <div className="space-y-1">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 text-xs w-8">×{item.ratio}</span>
                      <span className="text-zinc-700">{item.products?.product_name ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {alertFlags.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-red-700">注意フラグ</p>
                {alertFlags.map((f) => (
                  <p key={f.flag_code} className="text-xs text-red-600">
                    • {f.flag_code}{f.message ? `: ${f.message}` : ''}
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* 右: 確定フォーム */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-zinc-600">商品コード・PJ番号入力</h2>
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <LeafletFinalizeForm
                leafletId={leaflet.id}
                initialProductCode={leaflet.product_code}
                initialPjNo={leaflet.pj_no}
                initialLeafName={leaflet.leaf_name}
                initialLeadTime={leaflet.lead_time ?? '受注後約1週間'}
                currentStatus={leaflet.status}
                initialLeafImageUrl={leaflet.leaf_image_url}
              />
            </div>
            {leaflet.leaf_image_url && (
              <a href={leaflet.leaf_image_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-amber-700 hover:underline">
                最新リーフ画像を開く →
              </a>
            )}
            {leaflet.pdf_url && (
              <a href={leaflet.pdf_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline">
                最新PDF を開く →
              </a>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
