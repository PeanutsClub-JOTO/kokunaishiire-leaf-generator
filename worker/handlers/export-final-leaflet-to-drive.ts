import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Job } from '../../lib/supabase/types';
import { sanitizeDriveFileName, uploadImageUrlToDrive } from '../../lib/google/drive-export';

type LeafletForExport = {
  id: string;
  status: 'draft' | 'final';
  product_code: string | null;
  leaf_name: string | null;
  leaf_image_url: string | null;
};

export async function handleExportFinalLeafletToDrive(
  job: Job,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  if (!job.target_id) {
    throw new Error('export_final_leaflet_to_drive job requires target_id');
  }

  try {
    await supabase
      .from('leaflets')
      .update({ drive_export_status: 'exporting', drive_export_error: null })
      .eq('id', job.target_id);

    const { data: leaflet, error } = await supabase
      .from('leaflets')
      .select('id, status, product_code, leaf_name, leaf_image_url')
      .eq('id', job.target_id)
      .single();

    if (error || !leaflet) {
      throw new Error(error?.message ?? 'Leaflet not found');
    }

    const leaf = leaflet as LeafletForExport;
    if (leaf.status !== 'final') {
      throw new Error('Only final leaflets can be exported to Google Drive');
    }
    if (!leaf.leaf_image_url) {
      throw new Error('Leaflet image is not generated yet');
    }

    const baseName = sanitizeDriveFileName(
      [leaf.product_code, leaf.leaf_name, leaf.id.slice(0, 8)].filter(Boolean).join('_'),
    );
    const result = await uploadImageUrlToDrive({
      imageUrl: leaf.leaf_image_url,
      fileName: `${baseName}.png`,
    });

    await supabase
      .from('leaflets')
      .update({
        drive_file_id: result.fileId,
        drive_url: result.webViewLink ?? result.webContentLink,
        drive_export_status: 'done',
        drive_export_error: null,
      })
      .eq('id', job.target_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('leaflets')
      .update({ drive_export_status: 'error', drive_export_error: message })
      .eq('id', job.target_id);
    throw err;
  }
}
