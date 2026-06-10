/**
 * GET  /api/leaflets/[id] — リーフ詳細取得
 * PATCH /api/leaflets/[id] — 商品コード・PJ番号・ステータス更新
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data, error } = await supabase
    .from('leaflets')
    .select(`
      *,
      assort_groups(
        id, is_single, sheet_id,
        assort_items(ratio, products(id, product_name, image_url, jan_code, piece_size, shelf_life_days))
      )
    `)
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ leaflet: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  const body = await req.json() as {
    product_code?: string;
    pj_no?: string;
    status?: 'draft' | 'final';
    leaf_name?: string;
    lead_time?: string;
    note?: string;
  };

  const { data, error } = await supabase
    .from('leaflets')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leaflet: data });
}
