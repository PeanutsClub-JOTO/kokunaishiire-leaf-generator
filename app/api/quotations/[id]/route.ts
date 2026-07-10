/**
 * DELETE /api/quotations/[id] — 見積書とその全関連データを完全削除
 *
 * 削除順:
 *   1. Storage: 商品画像 (products/{productId}/*)
 *   2. Storage: リーフ画像・PDF (leaflets/{leafletId}/*)
 *   3. Storage: 見積書ファイル (quotations/{quotationId}/*)
 *   4. DB: quotations 行 → CASCADEでsheets/products/leafletsなど全消去
 *
 * Storage削除が一部失敗してもDB削除は実行する（容量圧迫を優先解消）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

async function removeFolder(
  supabase: ReturnType<typeof createServerClient>,
  bucket: string,
  folder: string,
): Promise<void> {
  const { data } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (!data || data.length === 0) return;
  const paths = data.map((f) => `${folder}/${f.name}`);
  await supabase.storage.from(bucket).remove(paths);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  // 関連リーフ・商品IDを事前に取得（Storage削除に必要）
  const { data: sheets } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', id);
  const sheetIds = (sheets ?? []).map((s) => s.id);

  let productIds: string[] = [];
  let leafletIds: string[] = [];
  if (sheetIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id')
      .in('sheet_id', sheetIds);
    productIds = (products ?? []).map((p) => p.id);

    const { data: groups } = await supabase
      .from('assort_groups')
      .select('id')
      .in('sheet_id', sheetIds);
    const groupIds = (groups ?? []).map((g) => g.id);

    if (groupIds.length > 0) {
      const { data: leaflets } = await supabase
        .from('leaflets')
        .select('id')
        .in('group_id', groupIds);
      leafletIds = (leaflets ?? []).map((l) => l.id);
    }
  }

  // Storage 掃除（失敗しても続行）
  await Promise.allSettled([
    ...productIds.map((pid) => removeFolder(supabase, 'product-images', `products/${pid}`)),
    ...leafletIds.map((lid) => removeFolder(supabase, 'leaflet-images', `leaflets/${lid}`)),
    ...leafletIds.map((lid) => removeFolder(supabase, 'leaflet-pdfs', `leaflets/${lid}`)),
    removeFolder(supabase, 'quotation-files', `quotations/${id}`),
  ]);

  // DB削除（CASCADEでsheets/products/assort_groups/assort_items/leafletsも消える）
  const { error } = await supabase.from('quotations').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
