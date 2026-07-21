/**
 * PATCH /api/products/[id] — 商品情報の手動編集
 *
 * ワークベンチから OCR取込結果の単価/最小ロット/上代/品名/JAN を修正できるようにする。
 * 単価を変えたときにサイジング再計算はクライアント側の useMemo で自動で走るため、
 * ここでは値の永続化だけを担当する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/types';

type ProductUpdate = Database['public']['Tables']['products']['Update'];

type PatchBody = {
  cost?: number | null;
  min_lot_qty?: number | null;
  retail_price?: number | null;
  product_name?: string | null;
  jan_code?: string | null;
};

function sanitizeNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function sanitizeString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;
  const body = (await req.json()) as PatchBody;

  const update: ProductUpdate = {};
  const cost = sanitizeNumber(body.cost);
  if (cost !== undefined) update.cost = cost;
  const minLot = sanitizeNumber(body.min_lot_qty);
  if (minLot !== undefined) update.min_lot_qty = minLot;
  const retail = sanitizeNumber(body.retail_price);
  if (retail !== undefined) update.retail_price = retail;
  const name = sanitizeString(body.product_name);
  if (name !== undefined) update.product_name = name;
  const jan = sanitizeString(body.jan_code);
  if (jan !== undefined) update.jan_code = jan;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: '更新対象のフィールドがありません' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('products')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product: data });
}
