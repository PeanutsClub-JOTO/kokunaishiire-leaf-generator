import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { LeafletData } from './generate-pdf';
import type { LeafletImageData } from './generate-image';

type ProductRef = {
  image_url: string | null;
  jan_code: string | null;
  piece_size: string | null;
  shelf_life_days: number | null;
  note: string | null;
  product_name: string | null;
};

type ItemRef = {
  ratio: number;
  products: ProductRef | ProductRef[] | null;
};

function pickProduct(products: ProductRef | ProductRef[] | null): ProductRef | null {
  if (Array.isArray(products)) return products[0] ?? null;
  return products;
}

function uniqueImages(items: ItemRef[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => pickProduct(item.products)?.image_url)
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

function firstNote(items: ItemRef[]): string | null {
  return items
    .map((item) => pickProduct(item.products)?.note)
    .find((note): note is string => Boolean(note?.trim())) ?? null;
}

async function loadLeafletBase(
  supabase: SupabaseClient<Database>,
  leafletId: string,
) {
  const { data: leaflet, error } = await supabase
    .from('leaflets')
    .select('*')
    .eq('id', leafletId)
    .single();

  if (error || !leaflet) {
    throw new Error(error?.message ?? 'Leaflet not found');
  }

  const { data: items } = await supabase
    .from('assort_items')
    .select('product_id, ratio, products(image_url, jan_code, piece_size, shelf_life_days, note, product_name)')
    .eq('group_id', leaflet.group_id);

  const normalizedItems = (items ?? []) as unknown as ItemRef[];
  const firstProduct = pickProduct(normalizedItems[0]?.products ?? null);

  // 注意フラグはリーフ自身（leaflet）・グループ（group）・構成商品（product）に
  // 分散して付与される。取込パイプラインは group/product にしか付けないため、
  // 3レベルすべてを集約しないとリーフ画像に表示されない。
  const productIds = ((items ?? []) as Array<{ product_id?: string }>)
    .map((i) => i.product_id)
    .filter((id): id is string => Boolean(id));

  const flagTargets: Array<{ type: string; id: string }> = [
    { type: 'leaflet', id: leafletId },
    { type: 'group', id: leaflet.group_id },
    ...productIds.map((id) => ({ type: 'product', id })),
  ];

  const { data: flags } = await supabase
    .from('alert_flags')
    .select('flag_code, message, target_type, target_id')
    .in('target_id', flagTargets.map((t) => t.id));

  const allowed = new Set(flagTargets.map((t) => `${t.type}:${t.id}`));
  const flagMessages = (flags ?? [])
    .filter((f) => allowed.has(`${f.target_type}:${f.target_id}`))
    .map((f) => f.message ?? f.flag_code);

  return { leaflet, items: normalizedItems, firstProduct, flagMessages };
}

export async function loadLeafletPdfData(
  supabase: SupabaseClient<Database>,
  leafletId: string,
): Promise<LeafletData> {
  const { leaflet, firstProduct, flagMessages } = await loadLeafletBase(supabase, leafletId);

  return {
    id: leaflet.id,
    status: leaflet.status,
    leafName: leaflet.leaf_name ?? '（品名未設定）',
    productCode: leaflet.product_code,
    pjNo: leaflet.pj_no,
    itemCount: leaflet.item_count ?? 1,
    leafQty: leaflet.leaf_qty ?? 0,
    costTotal: leaflet.cost_total ?? 0,
    wholesalePrice: leaflet.wholesale_price ?? 0,
    unitPrice: leaflet.unit_price ?? 0,
    isHalfOk: leaflet.is_half_ok ?? false,
    leadTime: leaflet.lead_time ?? '受注後約1週間',
    shelfLifeDays: leaflet.shelf_life_days ?? firstProduct?.shelf_life_days ?? 0,
    pieceSize: leaflet.piece_size ?? firstProduct?.piece_size ?? null,
    janCode: firstProduct?.jan_code ?? null,
    note: firstProduct?.note ?? null,
    imageUrl: firstProduct?.image_url ?? null,
    flagMessages,
  };
}

export async function loadLeafletImageData(
  supabase: SupabaseClient<Database>,
  leafletId: string,
): Promise<LeafletImageData> {
  const { leaflet, items, firstProduct, flagMessages } = await loadLeafletBase(supabase, leafletId);

  return {
    id: leaflet.id,
    status: leaflet.status,
    leafName: leaflet.leaf_name ?? '商品名未設定',
    productCode: leaflet.product_code,
    pjNo: leaflet.pj_no,
    itemCount: leaflet.item_count ?? Math.max(items.length, 1),
    leafQty: leaflet.leaf_qty ?? 0,
    wholesalePrice: leaflet.wholesale_price ?? 0,
    unitPrice: leaflet.unit_price ?? 0,
    isHalfOk: leaflet.is_half_ok ?? false,
    leadTime: leaflet.lead_time ?? '受注後約1週間',
    shelfLifeDays: leaflet.shelf_life_days ?? firstProduct?.shelf_life_days ?? 0,
    pieceSize: leaflet.piece_size ?? firstProduct?.piece_size ?? null,
    note: firstNote(items),
    productImages: uniqueImages(items),
    flagMessages,
  };
}
