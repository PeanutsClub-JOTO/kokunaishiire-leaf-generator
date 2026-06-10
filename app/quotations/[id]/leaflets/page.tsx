/**
 * 画面④（再設計） — リーフ ワークベンチ
 *
 * 1見積内の全リーフ画像を一覧表示 → 選択 → 横で情報・比率を編集 → プレビュー即時連動。
 * 比率スライダーもこの画面に集約する。
 */
export const dynamic = 'force-dynamic';

import * as fs from 'fs';
import * as path from 'path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/client';
import LeafletWorkbench, { type WorkbenchLeaflet } from '@/components/LeafletWorkbench';

type PageProps = { params: Promise<{ id: string }> };

export default async function LeafletsWorkbenchPage({ params }: PageProps) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data: quotation } = await supabase
    .from('quotations')
    .select('id, source_ref, client_name')
    .eq('id', id)
    .single();
  if (!quotation) notFound();

  const { data: sheets } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', id);
  const sheetIds = (sheets ?? []).map((s) => s.id);

  const { data: groups } = sheetIds.length
    ? await supabase
        .from('assort_groups')
        .select(`
          id, is_single, group_key,
          assort_items(product_id, ratio, products(id, no, product_name, image_url, piece_size, jan_code, shelf_life_days, cost, min_lot_qty)),
          leaflets(id, status, leaf_name, item_count, leaf_qty, cost_total, wholesale_price, unit_price, is_half_ok, lead_time, shelf_life_days, leaf_image_url, render_status, note)
        `)
        .in('sheet_id', sheetIds)
    : { data: [] };

  // ワークベンチ用に整形
  const leaflets: WorkbenchLeaflet[] = [];
  for (const g of groups ?? []) {
    const leaf = Array.isArray(g.leaflets) ? g.leaflets[0] : g.leaflets;
    if (!leaf) continue;
    const items = (Array.isArray(g.assort_items) ? g.assort_items : [g.assort_items]).filter(Boolean) as Array<{
      product_id: string;
      ratio: number;
      products: { id: string; no: number | null; product_name: string | null; image_url: string | null; piece_size: string | null; jan_code: string | null; shelf_life_days: number | null; cost: number | null; min_lot_qty: number | null } | { id: string; no: number | null; product_name: string | null; image_url: string | null; piece_size: string | null; jan_code: string | null; shelf_life_days: number | null; cost: number | null; min_lot_qty: number | null }[] | null;
    }>;
    leaflets.push({
      id: leaf.id,
      groupId: g.id,
      groupKey: g.group_key ?? `single:${leaf.id}`,
      isSingle: g.is_single,
      status: leaf.status,
      leafName: leaf.leaf_name ?? '（品名未設定）',
      itemCount: leaf.item_count ?? 1,
      leafQty: leaf.leaf_qty ?? 0,
      costTotal: leaf.cost_total ?? 0,
      wholesalePrice: leaf.wholesale_price ?? 0,
      unitPrice: leaf.unit_price ?? 0,
      isHalfOk: leaf.is_half_ok ?? false,
      leadTime: leaf.lead_time ?? '受注後約1週間',
      shelfLifeDays: leaf.shelf_life_days ?? null,
      leafImageUrl: leaf.leaf_image_url ?? null,
      renderStatus: leaf.render_status ?? 'pending',
      note: leaf.note ?? null,
      items: items.map((it) => {
        const p = Array.isArray(it.products) ? it.products[0] : it.products;
        return {
          productId: it.product_id,
          ratio: it.ratio,
          no: p?.no ?? null,
          productName: p?.product_name ?? '',
          imageUrl: p?.image_url ?? null,
          pieceSize: p?.piece_size ?? null,
          janCode: p?.jan_code ?? null,
          cost: p?.cost ?? 0,
          minLotQty: p?.min_lot_qty ?? 1,
        };
      }),
    });
  }

  // 単品 → アソートの順、種類数が多い順
  leaflets.sort((a, b) => Number(a.isSingle) - Number(b.isSingle) || b.itemCount - a.itemCount);

  const templateHtml = fs.readFileSync(
    path.join(process.cwd(), 'lib/leaf/image-template.html'),
    'utf-8',
  );

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
          <Link href="/" className="hover:text-zinc-700">見積一覧</Link>
          <span>/</span>
          <Link href={`/quotations/${id}/products`} className="hover:text-zinc-700">判定結果</Link>
          <span>/</span>
          <span className="text-zinc-600 font-medium">リーフ編集</span>
        </nav>
        <h1 className="text-lg font-bold text-zinc-900">リーフ ワークベンチ</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {quotation.client_name ?? ''} ／ 全 <b className="text-zinc-800">{leaflets.length}</b> リーフ
        </p>
      </header>

      {leaflets.length === 0 ? (
        <div className="text-center py-20 text-zinc-400">リーフがまだ生成されていません。</div>
      ) : (
        <LeafletWorkbench
          quotationId={id}
          leaflets={leaflets}
          templateHtml={templateHtml}
        />
      )}
    </div>
  );
}
