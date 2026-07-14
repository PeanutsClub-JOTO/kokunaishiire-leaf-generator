/**
 * xlsxインポートハンドラ
 *
 * 1. Supabase Storage から xlsx ダウンロード
 * 2. extractXlsxCells でセル値抽出
 * 3. シート/商品/アソートグループ/リーフをDBに保存
 * 4. extractXlsxImages で画像を商品に関連付け
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';
import { extractXlsxCells, type RawSheetData } from '../../lib/import/xlsx-cells';
import { extractXlsxImages } from '../../lib/import/xlsx-images';
import { extractXlsImages, isLegacyXls } from '../../lib/import/xls-images';
import { matchImageToProduct, type ProductImageTarget } from '../../lib/import/image-matching';
import { upscaleImageBuffer } from '../../lib/leaf/upscale-image';
import { groupProducts, type ProductForGrouping } from '../../lib/assort/grouping';
import { type Settings, DEFAULT_SETTINGS } from '../../lib/calc/engine';
import {
  sizeSingleV2,
  sizeAssortV2,
  type SizingV2Result,
  type SizingV2Settings,
} from '../../lib/calc/sizing-v2';
import { recordImportMetrics } from '../../lib/import/ocr-metrics';

type Supabase = SupabaseClient<Database>;
type Job = Database['public']['Tables']['jobs']['Row'];

type ProcessedProductRef = ProductImageTarget & {
  sheetId: string;
};

export async function loadSettings(supabase: Supabase): Promise<Settings> {
  const { data } = await supabase.from('app_settings').select('key, value');
  const s = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    switch (row.key) {
      case 'profit_coef':    s.profitCoef   = row.value; break;
      case 'sales_add':      s.salesAdd     = row.value; break;
      case 'unit_price_cap': s.unitPriceCap = row.value; break;
      case 'cost_cap':       s.costCap      = row.value; break;
      case 'half_base':      s.halfBase     = row.value; break;
      case 'shelf_min_days': s.shelfMinDays = row.value; break;
    }
  }
  return s;
}

/**
 * 通過判定＋注意フラグ（新サイジング v2 用）。
 * 除外条件: 単価(原価)>1000(unit_price>cap) / 最小ロット>33000(cost_over) /
 *           賞味期限<90 / 販売期間外。
 */
function evaluateGate(
  sizing: SizingV2Result,
  shelfDays: number | null,
  salesStart: Date | null,
  salesEnd: Date | null,
  today: Date,
  s: Settings,
): { reasons: string[]; alertCodes: string[] } {
  const reasons: string[] = [];
  if (!sizing.ok) {
    reasons.push(sizing.reason === 'unit_over' ? 'unit_price>cap' : 'cost_over');
  }
  if (shelfDays !== null && shelfDays < s.shelfMinDays) reasons.push('shelf<min');
  const inRange =
    salesStart === null || salesEnd === null
      ? true
      : salesStart <= today && today <= salesEnd;
  if (!inRange) reasons.push('sales_out_of_range');

  const alertCodes: string[] = [];
  // 単価(原価)が上限の90%超〜上限以内
  if (sizing.ok && sizing.unitPrice > s.unitPriceCap * 0.9 && sizing.unitPrice <= s.unitPriceCap) {
    alertCodes.push('unit_near_cap');
  }
  // 賞味期限が通過基準を満たすが1.5倍未満
  if (shelfDays !== null && shelfDays >= s.shelfMinDays && shelfDays < s.shelfMinDays * 1.5) {
    alertCodes.push('shelf_near');
  }
  return { reasons, alertCodes };
}

// YYYY-MM-DD をローカル時刻の年月日で生成する。
// toISOString() は UTC 変換するため JST(+9) では日付が1日前にずれてしまう
// （例: 2026-03-01 00:00 JST → "2026-02-28"）。販売期間・賞味期限の保存値が
// 狂うのを防ぐため、必ずローカル年月日でフォーマットする。
function dateStr(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * RawSheetData[] を DB に保存し、グルーピング・サイジング・リーフ生成まで行う。
 * xlsx と GSheet の両ハンドラから呼び出す共通パイプライン。
 */
export async function processRawSheets(
  supabase: Supabase,
  quotationId: string,
  rawSheets: RawSheetData[],
  settings: Settings,
): Promise<ProcessedProductRef[]> {
  const today = new Date();
  const processedProducts: ProcessedProductRef[] = [];

  for (const rawSheet of rawSheets) {
    if (rawSheet.products.length === 0) continue;

    // シートレコード作成
    const { data: sheet, error: sheetErr } = await supabase
      .from('sheets')
      .insert({
        quotation_id: quotationId,
        sheet_name: rawSheet.sheet_name,
        maker_name: rawSheet.maker_name,
      })
      .select()
      .single();
    if (sheetErr || !sheet) throw new Error(`Sheet insert failed: ${sheetErr?.message}`);

    // 商品レコード一括作成
    const productInserts = rawSheet.products.map((p) => ({
      sheet_id: sheet.id,
      no: p.no,
      maker_name: p.maker_name,
      product_name: p.product_name,
      spec_raw: p.spec_raw,
      spec_pieces: p.spec_pieces,
      spec_grams: p.spec_grams,
      irisu_raw: p.irisu_raw,
      case_qty: p.case_qty,
      lots_per_kou: p.lots_per_kou,
      min_lot_raw: p.min_lot_raw,
      min_lot_qty: p.min_lot_qty,
      retail_price: p.retail_price,
      cost: p.cost,
      jan_code: p.jan_code,
      shelf_life_days: p.shelf_life_days,
      sales_period_raw: p.sales_period_raw,
      sales_period_start: dateStr(p.sales_period_start),
      sales_period_end: dateStr(p.sales_period_end),
      piece_size: p.piece_size,
      note: p.note,
    }));

    const { data: insertedProducts, error: prodErr } = await supabase
      .from('products')
      .insert(productInserts)
      .select();
    if (prodErr || !insertedProducts) throw new Error(`Products insert failed: ${prodErr?.message}`);

    for (let i = 0; i < rawSheet.products.length; i++) {
      const raw = rawSheet.products[i];
      const db = insertedProducts[i];
      if (!db) continue;
      processedProducts.push({
        id: db.id,
        sheetId: sheet.id,
        sheetName: rawSheet.sheet_name,
        no: db.no,
        sourceRow: raw.source_row ?? null,
        sourceIndex: i,
      });
    }

    // パースエラーフラグ登録
    for (let i = 0; i < rawSheet.products.length; i++) {
      const raw = rawSheet.products[i];
      const db = insertedProducts[i];
      if (!db) continue;
      for (const errCode of raw.parse_errors) {
        await supabase.from('alert_flags').insert({
          target_type: 'product',
          target_id: db.id,
          flag_code: errCode,
          message: null,
        });
      }
    }

    // アソートグルーピング
    const forGrouping: ProductForGrouping[] = insertedProducts.map((p) => ({
      id: p.id,
      maker_name: p.maker_name,
      spec_pieces: p.spec_pieces,
      spec_grams: p.spec_grams,
      case_qty: p.case_qty,
      lots_per_kou: p.lots_per_kou,
      retail_price: p.retail_price,
      cost: p.cost ?? 0,
      min_lot_qty: p.min_lot_qty ?? 1,
    }));

    // 取込時は全商品を「単品」として構成する（アソートはワークベンチで後付け）。
    // ただし互換キー（メーカー|規格|入数|上代|単価|最小ロット数）は group_key として保持し、
    // ワークベンチ側で「同じキー＝アソート可能な仲間」を見つけられるようにする。
    const rawGroups = groupProducts(forGrouping, 0);
    const groups = rawGroups.flatMap((g) =>
      g.product_ids.map((pid) => ({
        // 互換性タグ: グルーピングできた塊は同一キーを共有、単独商品は一意キー
        group_key: g.is_single ? `single:${pid}` : g.group_key,
        is_single: true,
        product_ids: [pid],
      })),
    );

    for (const group of groups) {
      const dbProds = insertedProducts.filter((p) => group.product_ids.includes(p.id));

      // assort_group 作成
      const { data: assortGroup, error: agErr } = await supabase
        .from('assort_groups')
        .insert({ sheet_id: sheet.id, group_key: group.group_key, is_single: group.is_single })
        .select()
        .single();
      if (agErr || !assortGroup) throw new Error(`AssortGroup insert failed: ${agErr?.message}`);

      // assort_items（初期比率1:1:…:1）
      await supabase.from('assort_items').insert(
        group.product_ids.map((pid) => ({ group_id: assortGroup.id, product_id: pid, ratio: 1 })),
      );

      // サイジング計算（新方式: 単価=原価, 卸価格=原価合計, 1ロット=最小ロット数量）
      const v2Settings: SizingV2Settings = {
        profitCoef: settings.profitCoef,
        salesAdd: settings.salesAdd,
        unitPriceCap: settings.unitPriceCap,
        costCap: settings.costCap,
        halfBase: settings.halfBase,
      };
      const sizing = group.is_single
        ? sizeSingleV2(dbProds[0].cost ?? 0, dbProds[0].min_lot_qty ?? 1, v2Settings)
        : sizeAssortV2(
            dbProds.map((p) => ({ cost: p.cost ?? 0, minLotQty: p.min_lot_qty ?? 1, ratio: 1 })),
            v2Settings,
          );
      const itemCount = group.is_single ? 1 : dbProds.length;

      // 販売期間：最も制限の厳しい範囲を使用
      const starts = dbProds
        .map((p) => p.sales_period_start ? new Date(p.sales_period_start) : null)
        .filter((d): d is Date => d !== null);
      const ends = dbProds
        .map((p) => p.sales_period_end ? new Date(p.sales_period_end) : null)
        .filter((d): d is Date => d !== null);
      const combStart = starts.length > 0
        ? new Date(Math.max(...starts.map((d) => d.getTime())))
        : null;
      const combEnd = ends.length > 0
        ? new Date(Math.min(...ends.map((d) => d.getTime())))
        : null;

      // 賞味期限: グループ内の最短。全商品がnullなら null（不明=制限なし）
      const shelfValues = dbProds
        .map((p) => p.shelf_life_days)
        .filter((d): d is number => d !== null);
      const shelfDays: number | null = shelfValues.length > 0
        ? Math.min(...shelfValues)
        : null;

      const gate = evaluateGate(sizing, shelfDays, combStart, combEnd, today, settings);

      // リーフ作成（draft）
      const leafName = dbProds
        .map((p) => p.product_name)
        .filter(Boolean)
        .join('・');

      await supabase.from('leaflets').insert({
        group_id: assortGroup.id,
        leaf_name: leafName,
        item_count: itemCount,
        leaf_qty: sizing.leafQty,
        cost_total: sizing.costTotal,
        wholesale_price: sizing.wholesale,
        unit_price: sizing.unitPrice,
        is_half_ok: sizing.isHalfOk,
        shelf_life_days: shelfDays,
        status: 'draft',
      });

      // 注意フラグ（グループ単位）
      for (const reason of gate.reasons) {
        await supabase.from('alert_flags').insert({
          target_type: 'group',
          target_id: assortGroup.id,
          flag_code: reason,
          message: null,
        });
      }
      for (const code of gate.alertCodes) {
        await supabase.from('alert_flags').insert({
          target_type: 'group',
          target_id: assortGroup.id,
          flag_code: code,
          message: null,
        });
      }
    }
  }

  return processedProducts;
}

export async function handleImportXlsx(job: Job, supabase: Supabase): Promise<void> {
  if (!job.quotation_id) throw new Error('job has no quotation_id');

  // 見積書レコード取得
  const { data: quotation, error: qErr } = await supabase
    .from('quotations')
    .select('*')
    .eq('id', job.quotation_id)
    .single();
  if (qErr || !quotation) throw new Error(`Quotation not found: ${qErr?.message}`);

  // Storage からファイルダウンロード
  const storagePath = `quotations/${quotation.id}/${quotation.source_ref}`;
  const { data: blob, error: dlErr } = await supabase.storage
    .from('quotation-files')
    .download(storagePath);
  if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message}`);

  const buffer = Buffer.from(await blob.arrayBuffer());
  const settings = await loadSettings(supabase);

  // セル値抽出 → 共通パイプライン
  const rawSheets = extractXlsxCells(buffer);

  // ヘッダー辞書に当たらない未対応書式だと全シート0件になる。
  // 黙って「正常終了・データ無し」にすると取りこぼしに気付けないため、
  // 明示的にエラーにして AI-OCR フォールバック対象として可視化する。
  // （TODO: ここで Excel→画像化 → extractFromImagePdf による AI-OCR 経路に委譲する）
  const totalProducts = rawSheets.reduce((n, s) => n + s.products.length, 0);
  if (totalProducts === 0) {
    throw new Error(
      'UNSUPPORTED_XLSX_FORMAT: ヘッダー行を検出できませんでした（未対応書式の可能性）。AI-OCRフォールバックでの取込が必要です。',
    );
  }

  const processedProducts = await processRawSheets(supabase, quotation.id, rawSheets, settings);
  const legacyXls = isLegacyXls(buffer);

  // メトリクス記録（失敗しても本処理は続行）
  await recordImportMetrics(supabase, {
    jobId: job.id,
    quotationId: quotation.id,
    sourceType: legacyXls ? 'xls' : 'xlsx',
    rawSheets,
  }).catch((e) => console.warn('[import-xlsx] メトリクス記録失敗:', e));

  // Excel 画像抽出（失敗してもジョブは続行）
  // 旧形式 .xls（OLE2バイナリ）と .xlsx（zip）で抽出方法を自動判別する
  try {
    const imgResult = legacyXls
      ? await extractXlsImages(buffer, { includeInlineAnchors: true })
      : await extractXlsxImages(buffer, { includeInlineAnchors: true });
    console.log(
      `[import-xlsx] 画像抽出: ${legacyXls ? 'xls(BIFF)' : 'xlsx(zip)'} images=${imgResult.images.length} unmatched=${imgResult.unmatched.length}`,
    );
    if (imgResult.images.length > 0) {
      const usedProductIds = new Set<string>();
      const usedGridSlots = new Set<string>();
      const matchStats = { no: 0, sheet_order: 0, nearest_row: 0, unmatched: 0 };

      for (const img of imgResult.images) {
        const gridSlot =
          img.mappingStrategy === 'number_grid' && img.no !== null
            ? `${img.sheetName ?? ''}|${img.no}`
            : null;
        if (gridSlot && usedGridSlots.has(gridSlot)) {
          matchStats.unmatched++;
          continue;
        }

        const match = matchImageToProduct(img, processedProducts, {
          excludeProductIds: usedProductIds,
          preferSequentialFallback: true,
        });
        if (!match) {
          matchStats.unmatched++;
          continue;
        }
        const productId = match.productId;
        usedProductIds.add(productId);
        if (gridSlot) usedGridSlots.add(gridSlot);
        matchStats[match.reason]++;

        let uploadBuffer = img.buffer;
        let contentType = img.mimeType;
        let ext = img.mimeType.split('/')[1] ?? 'png';

        try {
          uploadBuffer = await upscaleImageBuffer(img.buffer);
          contentType = 'image/png';
          ext = 'png';
        } catch (upscaleErr) {
          console.warn('[import-xlsx] Image upscale failed, uploading original:', upscaleErr);
        }

        const imgPath = `products/${productId}/image.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('product-images')
          .upload(imgPath, uploadBuffer, { contentType, upsert: true });
        if (upErr) continue;

        const { data: urlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(imgPath);

        await supabase
          .from('products')
          .update({ image_url: urlData.publicUrl })
          .eq('id', productId);
      }
      console.log(
        `[import-xlsx] 画像紐付け: no=${matchStats.no} order=${matchStats.sheet_order} row=${matchStats.nearest_row} unmatched=${matchStats.unmatched}`,
      );
    }
  } catch (imgErr) {
    console.warn('[import-xlsx] Image extraction failed:', imgErr);
  }
}
