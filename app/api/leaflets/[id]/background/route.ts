/**
 * POST /api/leaflets/[id]/background — AI背景画像を（再）生成
 *
 * ai_background_enabled を true にし、既存の ai_background_url をクリアしてから
 * render_leaflet_image ジョブを積む。これにより次回レンダー時に必ず新しい
 * AI背景がGeminiで生成される（気に入らない結果を引き直すための「再生成」も兼ねる）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data: leaflet, error: leafErr } = await supabase
    .from('leaflets')
    .select('id')
    .eq('id', id)
    .single();

  if (leafErr || !leaflet) {
    return NextResponse.json({ error: leafErr?.message ?? 'Leaflet not found' }, { status: 404 });
  }

  await supabase
    .from('leaflets')
    .update({
      ai_background_enabled: true,
      ai_background_url: null,
      render_status: 'pending',
      render_error: null,
    })
    .eq('id', id);

  const { data: existingJob, error: existingErr } = await supabase
    .from('jobs')
    .select('id, status')
    .eq('job_type', 'render_leaflet_image')
    .eq('target_id', id)
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (existingJob) {
    return NextResponse.json({ job_id: existingJob.id, status: existingJob.status, deduped: true });
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'render_leaflet_image',
      target_id: id,
      status: 'queued',
      progress: 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job_id: job.id, status: job.status });
}
