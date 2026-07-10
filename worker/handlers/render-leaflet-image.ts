import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Job } from '../../lib/supabase/types';
import { loadLeafletImageData } from '../../lib/leaf/load-data';
import { renderLeafImageBuffer } from '../leaf-renderer/render';
import { generateCatchphrase } from '../../lib/leaf/ai-catchphrase';
import { generateBackground } from '../../lib/leaf/ai-background';
import { selectLeafTheme, detectCategory, flavorOf } from '../../lib/leaf/generate-image';

export async function handleRenderLeafletImage(
  job: Job,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  if (!job.target_id) {
    throw new Error('render_leaflet_image job requires target_id');
  }

  await supabase
    .from('leaflets')
    .update({ render_status: 'rendering', render_error: null })
    .eq('id', job.target_id);

  const leafData = await loadLeafletImageData(supabase, job.target_id);

  // AI生成（失敗してもルールベースにフォールバック）
  const theme = selectLeafTheme(leafData);
  const category = detectCategory(leafData.leafName);
  const flavor = flavorOf(leafData.leafName);

  const [catchphrase, bgBuffer] = await Promise.all([
    generateCatchphrase({
      leafName: leafData.leafName,
      category,
      flavor,
      itemCount: leafData.itemCount,
      note: leafData.note,
      leadTime: leafData.leadTime,
    }),
    generateBackground({
      leafName: leafData.leafName,
      category,
      flavor,
      themeLabel: theme.label,
      itemCount: leafData.itemCount,
      productNames: leafData.productNames,
      // AI背景の入力にはURLのみ渡す（拡大率・位置の調整値は不要）
      productImages: leafData.productImages.map((p) => (typeof p === 'string' ? p : p.url)),
    }),
  ]);

  const aiBgDataUrl = bgBuffer
    ? `data:image/png;base64,${bgBuffer.toString('base64')}`
    : null;
  const renderWarning = bgBuffer
    ? null
    : 'AI背景生成に失敗、またはAPIキー未設定のため、通常背景で生成しました。';

  let aiBackgroundUrl: string | null = null;
  if (bgBuffer) {
    const bgStoragePath = `leaflets/${job.target_id}/background_${Date.now()}.png`;
    const { error: bgUploadErr } = await supabase.storage
      .from('leaflet-images')
      .upload(bgStoragePath, bgBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (bgUploadErr) {
      console.warn('[worker] AI背景画像の保存に失敗しました:', bgUploadErr.message);
    } else {
      const { data: bgUrlData } = supabase.storage
        .from('leaflet-images')
        .getPublicUrl(bgStoragePath);
      aiBackgroundUrl = bgUrlData.publicUrl;
    }
  }

  const png = await renderLeafImageBuffer({ ...leafData, catchphrase, aiBgDataUrl });
  const storagePath = `leaflets/${job.target_id}/${leafData.status}_${Date.now()}.png`;

  const { error: uploadErr } = await supabase.storage
    .from('leaflet-images')
    .upload(storagePath, png, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadErr) {
    await supabase
      .from('leaflets')
      .update({ render_status: 'error', render_error: uploadErr.message })
      .eq('id', job.target_id);
    throw uploadErr;
  }

  const { data: urlData } = supabase.storage
    .from('leaflet-images')
    .getPublicUrl(storagePath);

  const update: Database['public']['Tables']['leaflets']['Update'] = {
    leaf_image_url: urlData.publicUrl,
    render_status: 'done',
    render_error: renderWarning,
    template_version: 'leaf-image-v1',
  };
  if (aiBackgroundUrl) update.ai_background_url = aiBackgroundUrl;

  const { error: updateErr } = await supabase
    .from('leaflets')
    .update(update)
    .eq('id', job.target_id);

  if (updateErr && aiBackgroundUrl) {
    console.warn('[worker] AI背景URLの保存に失敗しました。背景URLなしで更新します:', updateErr.message);
    const fallbackUpdate = { ...update };
    delete fallbackUpdate.ai_background_url;
    const { error: fallbackErr } = await supabase
      .from('leaflets')
      .update(fallbackUpdate)
      .eq('id', job.target_id);
    if (fallbackErr) throw fallbackErr;
  } else if (updateErr) {
    throw updateErr;
  }
}
