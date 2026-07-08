/**
 * POST /api/gmail/scan
 *
 * Gmail監視ジョブをキューに積む入口。
 * 実際のGmail API検索・ラベル付与は worker/handlers/gmail-scan.ts に後続実装する。
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';

export async function POST() {
  const supabase = createServerClient();

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      job_type: 'gmail_scan',
      status: 'queued',
    })
    .select()
    .single();

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Job creation failed' }, { status: 500 });
  }

  return NextResponse.json({ job_id: job.id, status: 'queued' });
}
