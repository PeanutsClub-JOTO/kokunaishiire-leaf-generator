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
import { DEFAULT_V2_SETTINGS, sizeAssortV2, type SizingV2Settings } from '@/lib/calc/sizing-v2';
import { groupProducts, type ProductForGrouping } from '@/lib/assort/grouping';

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = (await req.json()) as {
    sheetGroupId: string;
    items: { product_id: string; ratio: number }[];
    leaf_name?: string;
    lead_time?: string;
    note?: string;
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

  // 商品情報（アソート互換条件・原価・最小ロット・賞味期限）を取得
  const productIds = body.items.map((i) => i.product_id);
  const requestedIds = new Set(productIds);
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, sheet_id, product_name, maker_name, spec_pieces, spec_grams, case_qty, lots_per_kou, retail_price, cost, min_lot_qty, shelf_life_days')
    .eq('sheet_id', baseGroup.sheet_id)
    .in('id', productIds);
  if (pErr || !products || products.length !== requestedIds.size) {
    return NextResponse.json({ error: 'products not found' }, { status: 404 });
  }

  const groupingProducts: ProductForGrouping[] = products.map((p) => ({
    id: p.id,
    maker_name: p.maker_name,
    spec_pieces: p.spec_pieces,
    spec_grams: p.spec_grams,
    case_qty: p.case_qty,
    lots_per_kou: p.lots_per_kou,
    retail_price: p.retail_price,
    cost: p.cost ?? 0,
    min_lot_qty: p.min_lot_qty ?? 0,
  }));
  const compatibilityGroups = groupProducts(groupingProducts, 0);
  if (compatibilityGroups.length !== 1 || compatibilityGroups[0].is_single) {
    return NextResponse.json(
      { error: '単価・上代・規格・入数・最小ロット数が同じ商品だけアソートできます' },
      { status: 422 },
    );
  }

  // 設定取得
  const { data: settingsRows } = await supabase.from('app_settings').select('key, value');
  const s: SizingV2Settings = { ...DEFAULT_V2_SETTINGS };
  for (const row of settingsRows ?? []) {
    if (row.key === 'profit_coef') s.profitCoef = row.value;
    if (row.key === 'sales_add') s.salesAdd = row.value;
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

  // 同じ組み合わせのアソートが既にあれば再利用（重複生成防止）
  const comboKey = `assort:${[...productIds].sort().join('+')}`;
  const { data: existing } = await supabase
    .from('assort_groups')
    .select('id')
    .eq('sheet_id', baseGroup.sheet_id)
    .eq('group_key', comboKey)
    .maybeSingle();

  let groupId: string;
  if (existing) {
    groupId = existing.id;
    // 既存の構成・リーフを今回の比率で更新
    await supabase.from('assort_items').delete().eq('group_id', groupId);
    await supabase.from('assort_items').insert(
      body.items.map((i) => ({ group_id: groupId, product_id: i.product_id, ratio: i.ratio })),
    );
  } else {
    const { data: group, error: gErr } = await supabase
      .from('assort_groups')
      .insert({ sheet_id: baseGroup.sheet_id, group_key: comboKey, is_single: false })
      .select()
      .single();
    if (gErr || !group) {
      return NextResponse.json({ error: `group作成失敗: ${gErr?.message}` }, { status: 500 });
    }
    groupId = group.id;
    await supabase.from('assort_items').insert(
      body.items.map((i) => ({ group_id: groupId, product_id: i.product_id, ratio: i.ratio })),
    );
  }

  // 賞味期限はグループ内最短
  const shelfValues = products.map((p) => p.shelf_life_days).filter((d): d is number => d != null);
  const shelfDays = shelfValues.length ? Math.min(...shelfValues) : null;

  const leafName = body.leaf_name ?? products.map((p) => p.product_name).filter(Boolean).join('・');

  const leafFields = {
    leaf_name: leafName,
    item_count: products.length,
    leaf_qty: sizing.leafQty,
    cost_total: sizing.costTotal,
    wholesale_price: sizing.wholesale,
    unit_price: sizing.unitPrice,
    is_half_ok: sizing.isHalfOk,
    shelf_life_days: shelfDays,
    lead_time: body.lead_time ?? '受注後約1週間',
    note: body.note ?? null,
    status: 'draft' as const,
  };

  // 既存グループ再利用時はリーフを更新、新規時は作成
  const { data: existingLeaf } = await supabase
    .from('leaflets')
    .select('id')
    .eq('group_id', groupId)
    .maybeSingle();

  let leaflet: { id: string } | null = null;
  if (existingLeaf) {
    const { data, error: uErr } = await supabase
      .from('leaflets')
      .update(leafFields)
      .eq('id', existingLeaf.id)
      .select()
      .single();
    if (uErr) return NextResponse.json({ error: `leaflet更新失敗: ${uErr.message}` }, { status: 500 });
    leaflet = data;
  } else {
    const { data, error: lErr } = await supabase
      .from('leaflets')
      .insert({ group_id: groupId, ...leafFields })
      .select()
      .single();
    if (lErr) return NextResponse.json({ error: `leaflet作成失敗: ${lErr.message}` }, { status: 500 });
    leaflet = data;
  }

  return NextResponse.json({ group_id: groupId, leaflet, sizing });
}
