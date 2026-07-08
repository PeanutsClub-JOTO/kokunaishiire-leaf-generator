import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';

type Supabase = SupabaseClient<Database>;

export async function queueLeafletImageJobsForQuotation(
  supabase: Supabase,
  quotationId: string,
): Promise<number> {
  const { data: sheets, error: sheetErr } = await supabase
    .from('sheets')
    .select('id')
    .eq('quotation_id', quotationId);
  if (sheetErr) throw new Error(`Load sheets failed: ${sheetErr.message}`);

  const sheetIds = (sheets ?? []).map((s) => s.id);
  if (sheetIds.length === 0) return 0;

  const { data: groups, error: groupErr } = await supabase
    .from('assort_groups')
    .select('id')
    .in('sheet_id', sheetIds);
  if (groupErr) throw new Error(`Load assort groups failed: ${groupErr.message}`);

  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length === 0) return 0;

  const { data: leaflets, error: leafErr } = await supabase
    .from('leaflets')
    .select('id, leaf_image_url')
    .in('group_id', groupIds);
  if (leafErr) throw new Error(`Load leaflets failed: ${leafErr.message}`);

  const candidateIds = (leaflets ?? [])
    .filter((leaflet) => !leaflet.leaf_image_url)
    .map((leaflet) => leaflet.id);
  if (candidateIds.length === 0) return 0;

  const { data: existingJobs, error: jobErr } = await supabase
    .from('jobs')
    .select('target_id')
    .eq('job_type', 'render_leaflet_image')
    .in('status', ['queued', 'running'])
    .in('target_id', candidateIds);
  if (jobErr) throw new Error(`Load existing render jobs failed: ${jobErr.message}`);

  const alreadyQueued = new Set((existingJobs ?? []).map((job) => job.target_id).filter(Boolean));
  const inserts = candidateIds
    .filter((id) => !alreadyQueued.has(id))
    .map((id) => ({
      target_id: id,
      job_type: 'render_leaflet_image' as const,
      status: 'queued' as const,
    }));

  if (inserts.length === 0) return 0;

  const { error: insertErr } = await supabase.from('jobs').insert(inserts);
  if (insertErr) throw new Error(`Queue leaflet image jobs failed: ${insertErr.message}`);

  return inserts.length;
}
