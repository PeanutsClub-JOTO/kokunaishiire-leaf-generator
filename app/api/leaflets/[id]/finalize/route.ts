/**
 * POST /api/leaflets/[id]/finalize
 *
 * リーフを正式確定し、確定リーフ一覧へ3日間表示し、
 * Google Drive転送ジョブを重複なく登録する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/types';

type FinalizeBody = {
  product_code?: string;
  pj_no?: string;
  leaf_name?: string;
  lead_time?: string;
  note?: string;
  assort_followup_status?: 'unasked' | 'not_needed' | 'accepted' | 'declined';
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<unknown> },
) {
  const supabase = createServerClient();
  const { id } = await params as { id: string };
  const body = await req.json().catch(() => ({})) as FinalizeBody;

  const { data: current, error: currentErr } = await supabase
    .from('leaflets')
    .select('id, leaf_image_url, render_status')
    .eq('id', id)
    .single();

  if (currentErr || !current) {
    return NextResponse.json({ error: currentErr?.message ?? 'Leaflet not found' }, { status: 404 });
  }
  if (!current.leaf_image_url) {
    return NextResponse.json(
      { error: 'リーフ画像がまだ生成されていません。画像生成後に確定してください。' },
      { status: 422 },
    );
  }

  const now = new Date();
  const visibleUntil = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const update: Database['public']['Tables']['leaflets']['Update'] = {
    status: 'final',
    finalized_at: now.toISOString(),
    final_visible_until: visibleUntil.toISOString(),
    drive_export_status: 'pending',
    drive_export_error: null,
    updated_at: now.toISOString(),
    assort_followup_status: body.assort_followup_status ?? 'unasked',
  };
  if (body.leaf_name !== undefined) update.leaf_name = body.leaf_name;
  if (body.lead_time !== undefined) update.lead_time = body.lead_time;
  if (body.note !== undefined) update.note = body.note;
  if (body.product_code !== undefined) update.product_code = body.product_code;
  if (body.pj_no !== undefined) update.pj_no = body.pj_no;

  const { data: leaflet, error: updateErr } = await supabase
    .from('leaflets')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { data: existingJob, error: existingErr } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('job_type', 'export_final_leaflet_to_drive')
    .eq('target_id', id)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  if (existingJob) {
    return NextResponse.json({
      leaflet,
      job_id: existingJob.id,
      status: existingJob.status,
      deduped: true,
    });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      job_type: 'export_final_leaflet_to_drive',
      target_id: id,
      status: 'queued',
      progress: 0,
    })
    .select()
    .single();

  if (jobErr) {
    await supabase
      .from('leaflets')
      .update({ drive_export_status: 'error', drive_export_error: jobErr.message })
      .eq('id', id);
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  return NextResponse.json({ leaflet, job_id: job.id, status: job.status });
}
