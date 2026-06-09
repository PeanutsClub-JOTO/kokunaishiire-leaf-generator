/**
 * POST /api/assort/[groupId]/recalc — 比率変更後の再計算
 *
 * body: { ratios: { product_id: string; ratio: number }[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { planAssort, type AssortType, type Settings } from '@/lib/calc/engine';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const supabase = createServerClient();
  const { groupId } = await params;
  const { ratios } = await req.json() as {
    ratios: { product_id: string; ratio: number }[];
  };

  // app_settings から定数を取得
  const { data: settings } = await supabase
    .from('app_settings')
    .select('key, value');

  const s: Settings = {
    profitCoef: 1.25,
    salesAdd: 3000,
    unitPriceCap: 1000,
    costCap: 33000,
    halfBase: 16500,
    shelfMinDays: 90,
  };

  if (settings) {
    for (const row of settings) {
      switch (row.key) {
        case 'profit_coef':    s.profitCoef   = row.value; break;
        case 'sales_add':      s.salesAdd     = row.value; break;
        case 'unit_price_cap': s.unitPriceCap = row.value; break;
        case 'cost_cap':       s.costCap      = row.value; break;
        case 'half_base':      s.halfBase     = row.value; break;
        case 'shelf_min_days': s.shelfMinDays = row.value; break;
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

  const types: AssortType[] = items.map((item) => {
    const product = item.products as { cost: number; min_lot_qty: number } | null;
    return {
      cost: product?.cost ?? 0,
      minLotQty: product?.min_lot_qty ?? 1,
      ratio: ratioMap.get(item.product_id) ?? item.ratio,
    };
  });

  const result = planAssort(types, s);

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
  }

  return NextResponse.json({ result });
}
