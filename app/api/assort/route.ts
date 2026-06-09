/**
 * GET /api/assort?quotation_id=xxx — アソートグループ一覧
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const quotationId = req.nextUrl.searchParams.get('quotation_id');

  if (!quotationId) {
    return NextResponse.json({ error: 'quotation_id is required' }, { status: 400 });
  }

  // quotation に紐づく sheet IDs を取得
  const { data: sheets, error: sheetsErr } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', quotationId);

  if (sheetsErr) {
    return NextResponse.json({ error: sheetsErr.message }, { status: 500 });
  }

  const sheetIds = (sheets ?? []).map((s) => s.id);
  if (sheetIds.length === 0) {
    return NextResponse.json({ groups: [] });
  }

  const { data, error } = await supabase
    .from('assort_groups')
    .select(`
      id, group_key, is_single, sheet_id,
      assort_items(
        id, ratio,
        products(id, no, maker_name, product_name, spec_raw, spec_pieces, spec_grams, cost, min_lot_qty, image_url, jan_code, shelf_life_days, piece_size)
      ),
      leaflets(
        id, status, leaf_name, product_code, pj_no, item_count,
        leaf_qty, cost_total, wholesale_price, unit_price, is_half_ok,
        lead_time, shelf_life_days, pdf_url
      )
    `)
    .in('sheet_id', sheetIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ groups: data });
}
