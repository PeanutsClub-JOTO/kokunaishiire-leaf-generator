import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Job } from '../../lib/supabase/types';
import { loadLeafletImageData } from '../../lib/leaf/load-data';
import { renderLeafImageBuffer } from '../leaf-renderer/render';

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
  const png = await renderLeafImageBuffer(leafData);
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
      render_error: null,
      template_version: 'leaf-image-v1',
    })
    .eq('id', job.target_id);
}
