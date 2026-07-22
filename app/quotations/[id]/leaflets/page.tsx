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
import { DEFAULT_V2_SETTINGS, type SizingV2Settings } from '@/lib/calc/sizing-v2';

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
          assort_items(product_id, ratio, products(id, no, product_name, image_url, piece_size, jan_code, shelf_life_days, cost, min_lot_qty, retail_price)),
          leaflets(*)
        `)
        .in('sheet_id', sheetIds)
    : { data: [] };

  const { data: settingsRows } = await supabase
    .from('app_settings')
    .select('key, value');
  const sizingSettings: SizingV2Settings = { ...DEFAULT_V2_SETTINGS };
  for (const row of settingsRows ?? []) {
    if (row.key === 'profit_coef') sizingSettings.profitCoef = row.value;
    if (row.key === 'sales_add') sizingSettings.salesAdd = row.value;
    if (row.key === 'unit_price_cap') sizingSettings.unitPriceCap = row.value;
    if (row.key === 'cost_cap') sizingSettings.costCap = row.value;
    if (row.key === 'half_base') sizingSettings.halfBase = row.value;
  }

  // ワークベンチ用に整形
  const leaflets: WorkbenchLeaflet[] = [];
  for (const g of groups ?? []) {
    const leaf = Array.isArray(g.leaflets) ? g.leaflets[0] : g.leaflets;
    if (!leaf) continue;
    type ProductRef = { id: string; no: number | null; product_name: string | null; image_url: string | null; piece_size: string | null; jan_code: string | null; shelf_life_days: number | null; cost: number | null; min_lot_qty: number | null; retail_price: number | null };
    const items = (Array.isArray(g.assort_items) ? g.assort_items : [g.assort_items]).filter(Boolean) as Array<{
      product_id: string;
      ratio: number;
      products: ProductRef | ProductRef[] | null;
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
      aiBackgroundUrl: leaf.ai_background_url ?? null,
      renderStatus: leaf.render_status ?? 'pending',
      renderError: leaf.render_error ?? null,
      finalizedAt: leaf.finalized_at ?? null,
      finalVisibleUntil: leaf.final_visible_until ?? null,
      driveUrl: leaf.drive_url ?? null,
      driveExportStatus: leaf.drive_export_status ?? 'none',
      driveExportError: leaf.drive_export_error ?? null,
      assortFollowupStatus: leaf.assort_followup_status ?? 'unasked',
      note: leaf.note ?? null,
      imageOverrides: (leaf.image_overrides ?? null) as Record<string, { scale?: number; x?: number; y?: number }> | null,
      mainCopyOverride: leaf.main_copy_override ?? null,
      aiMainCopy: leaf.ai_main_copy ?? null,
      aiSubCopy: leaf.ai_sub_copy ?? null,
      productCode: leaf.product_code ?? null,
      pjNo: leaf.pj_no ?? null,
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
          retailPrice: p?.retail_price ?? null,
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
          settings={sizingSettings}
        />
      )}
    </div>
  );
}
