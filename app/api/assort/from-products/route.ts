/**
 * POST /api/assort/from-products — 選択した商品から新しいアソートリーフを作成
 *
 * body: {
 *   sheetGroupId: string,   // 基準となる既存グループID（sheet_id 解決用）
 *   items: { product_id: string; ratio: number }[],
 *   leaf_name?: string,
 *   lead_time?: string,
 * }
 *
 * ワークベンチで複数商品を選択してアソート化する際に呼ぶ。
 * 既存の単品リーフは残し、別途アソートリーフを追加する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { sizeAssortV2, type SizingV2Settings } from '@/lib/calc/sizing-v2';

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = (await req.json()) as {
    sheetGroupId: string;
    items: { product_id: string; ratio: number }[];
    leaf_name?: string;
    lead_time?: string;
  };

  if (!body.sheetGroupId || !body.items || body.items.length < 2) {
    return NextResponse.json({ error: 'sheetGroupId と items(2件以上) が必要です' }, { status: 400 });
  }

  // sheet_id を基準グループから解決
  const { data: baseGroup, error: bgErr } = await supabase
    .from('assort_groups')
    .select('sheet_id, group_key')
    .eq('id', body.sheetGroupId)
    .single();
  if (bgErr || !baseGroup) {
    return NextResponse.json({ error: 'base group not found' }, { status: 404 });
  }

  // 商品情報（原価・最小ロット・賞味期限）を取得
  const productIds = body.items.map((i) => i.product_id);
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, product_name, cost, min_lot_qty, shelf_life_days')
    .in('id', productIds);
  if (pErr || !products) {
    return NextResponse.json({ error: 'products not found' }, { status: 404 });
  }

  // 設定取得
  const { data: settingsRows } = await supabase.from('app_settings').select('key, value');
  const s: SizingV2Settings = { unitPriceCap: 1000, costCap: 33000, halfBase: 16500 };
  for (const row of settingsRows ?? []) {
    if (row.key === 'unit_price_cap') s.unitPriceCap = row.value;
    if (row.key === 'cost_cap') s.costCap = row.value;
    if (row.key === 'half_base') s.halfBase = row.value;
  }

  const ratioById = new Map(body.items.map((i) => [i.product_id, i.ratio]));
  const types = products.map((p) => ({
    cost: p.cost ?? 0,
    minLotQty: p.min_lot_qty ?? 1,
    ratio: ratioById.get(p.id) ?? 1,
  }));
  const sizing = sizeAssortV2(types, s);
  if (!sizing.ok) {
    return NextResponse.json(
      { error: `この構成は企画対象外です: ${sizing.reason}`, sizing },
      { status: 422 },
    );
  }

  // 新しいアソートグループを作成
  const { data: group, error: gErr } = await supabase
    .from('assort_groups')
    .insert({ sheet_id: baseGroup.sheet_id, group_key: `assort:${productIds.sort().join('+')}`, is_single: false })
    .select()
    .single();
  if (gErr || !group) {
    return NextResponse.json({ error: `group作成失敗: ${gErr?.message}` }, { status: 500 });
  }

  await supabase.from('assort_items').insert(
    body.items.map((i) => ({ group_id: group.id, product_id: i.product_id, ratio: i.ratio })),
  );

  // 賞味期限はグループ内最短
  const shelfValues = products.map((p) => p.shelf_life_days).filter((d): d is number => d != null);
  const shelfDays = shelfValues.length ? Math.min(...shelfValues) : null;

  const leafName = body.leaf_name ?? products.map((p) => p.product_name).filter(Boolean).join('・');

  const { data: leaflet, error: lErr } = await supabase
    .from('leaflets')
    .insert({
      group_id: group.id,
      leaf_name: leafName,
      item_count: products.length,
      leaf_qty: sizing.leafQty,
      cost_total: sizing.costTotal,
      wholesale_price: sizing.costTotal,
      unit_price: sizing.unitPrice,
      is_half_ok: sizing.isHalfOk,
      shelf_life_days: shelfDays,
      lead_time: body.lead_time ?? '受注後約1週間',
      status: 'draft',
    })
    .select()
    .single();
  if (lErr) {
    return NextResponse.json({ error: `leaflet作成失敗: ${lErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ group_id: group.id, leaflet, sizing });
}
