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
      productImages: leafData.productImages,
    }),
  ]);

  const aiBgDataUrl = bgBuffer
    ? `data:image/png;base64,${bgBuffer.toString('base64')}`
    : null;
  const renderWarning = bgBuffer
    ? null
    : 'AI背景生成に失敗、またはAPIキー未設定のため、通常背景で生成しました。';

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

  await supabase
    .from('leaflets')
    .update({
      leaf_image_url: urlData.publicUrl,
      render_status: 'done',
      render_error: renderWarning,
      template_version: 'leaf-image-v1',
    })
    .eq('id', job.target_id);
}
