import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

async function removeFolder(
  supabase: SupabaseClient<Database>,
  bucket: string,
  folder: string,
): Promise<void> {
  const { data } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
  if (!data || data.length === 0) return;
  const paths = data.map((f) => `${folder}/${f.name}`);
  await supabase.storage.from(bucket).remove(paths);
}

export async function deleteQuotationFull(
  supabase: SupabaseClient<Database>,
  quotationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: sheets } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', quotationId);
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

  await Promise.allSettled([
    ...productIds.map((pid) => removeFolder(supabase, 'product-images', `products/${pid}`)),
    ...leafletIds.map((lid) => removeFolder(supabase, 'leaflet-images', `leaflets/${lid}`)),
    ...leafletIds.map((lid) => removeFolder(supabase, 'leaflet-pdfs', `leaflets/${lid}`)),
    removeFolder(supabase, 'quotation-files', `quotations/${quotationId}`),
  ]);

  const { error } = await supabase.from('quotations').delete().eq('id', quotationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
