/**
 * POST /api/assort/[groupId]/recalc — 比率変更後の再計算
 *
 * body: { ratios: { product_id: string; ratio: number }[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { sizeAssortV2, type AssortTypeV2, type SizingV2Settings } from '@/lib/calc/sizing-v2';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const supabase = createServerClient();
  const { groupId } = await params;
  const { ratios } = await req.json() as {
    ratios: { product_id: string; ratio: number }[];
  };

  if (!ratios || ratios.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // app_settings から定数を取得
  const { data: settingsData } = await supabase
    .from('app_settings')
    .select('key, value');

  const s: SizingV2Settings = {
    profitCoef: 1.25,
    salesAdd: 3000,
    unitPriceCap: 1000,
    costCap: 33000,
    halfBase: 16500,
  };
  if (settingsData) {
    for (const row of settingsData) {
      switch (row.key) {
        case 'profit_coef':    s.profitCoef = row.value; break;
        case 'sales_add':      s.salesAdd = row.value; break;
        case 'unit_price_cap': s.unitPriceCap = row.value; break;
        case 'cost_cap':       s.costCap = row.value; break;
        case 'half_base':      s.halfBase = row.value; break;
      }
    }
  }

  // assort_items + products を取得
  const { data: items } = await supabase
    .from('assort_items')
    .select('product_id, ratio, products(cost, min_lot_qty)')
    .eq('group_id', groupId);

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  // 比率を更新
  const ratioMap = new Map(ratios.map((r) => [r.product_id, r.ratio]));

  const types: AssortTypeV2[] = items.map((item) => {
    // Supabase types can be arrays or objects
    const product = Array.isArray(item.products) ? item.products[0] : item.products;
    return {
      cost: product?.cost ?? 0,
      minLotQty: product?.min_lot_qty ?? 1,
      ratio: ratioMap.get(item.product_id) ?? item.ratio,
    };
  });

  const result = sizeAssortV2(types, s);

  // assort_items の ratio を更新
  for (const { product_id, ratio } of ratios) {
    await supabase
      .from('assort_items')
      .update({ ratio })
      .eq('group_id', groupId)
      .eq('product_id', product_id);
  }

  // leaflet を更新（draft ステータスのもののみ）
  if (result.ok) {
    await supabase
      .from('leaflets')
      .update({
        leaf_qty: result.leafQty,
        cost_total: result.costTotal,
        wholesale_price: result.wholesale,
        unit_price: result.unitPrice,
        is_half_ok: result.isHalfOk,
        item_count: result.itemCount,
      })
      .eq('group_id', groupId)
      .eq('status', 'draft');
  } else {
    // If not ok, we could optionally store the failure reason or mark it somehow,
    // but typically we just return it to UI so user can fix it.
    await supabase
      .from('leaflets')
      .update({
        leaf_qty: result.leafQty,
        cost_total: result.costTotal,
        wholesale_price: result.wholesale,
        unit_price: result.unitPrice,
        is_half_ok: result.isHalfOk,
        item_count: result.itemCount,
      })
      .eq('group_id', groupId)
      .eq('status', 'draft');
  }

  return NextResponse.json({ result });
}
