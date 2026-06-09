/**
 * GET /api/products?quotation_id=xxx — 見積書の商品一覧
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const quotationId = req.nextUrl.searchParams.get('quotation_id');

  if (!quotationId) {
    return NextResponse.json({ error: 'quotation_id is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('sheets')
    .select(`
      id, sheet_name, maker_name,
      products(
        id, no, maker_name, product_name, spec_raw, spec_pieces, spec_grams,
        irisu_raw, case_qty, lots_per_kou, min_lot_raw, min_lot_qty,
        retail_price, cost, jan_code, shelf_life_days, sales_period_raw,
        sales_period_start, sales_period_end, piece_size, image_url, note,
        alert_flags(flag_code, message)
      )
    `)
    .eq('quotation_id', quotationId)
    .order('created_at', { referencedTable: 'products', ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sheets: data });
}
