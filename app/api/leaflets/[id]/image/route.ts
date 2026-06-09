/**
 * POST /api/leaflets/[id]/image — リーフ画像生成ジョブ登録
 *
 * Puppeteer を API リクエスト内で動かさず、jobs に積んでワーカーで処理する。
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
    .update({ render_status: 'pending', render_error: null })
    .eq('id', id);

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
