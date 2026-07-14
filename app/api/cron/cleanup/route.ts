/**
 * GET /api/cron/cleanup
 *
 * Vercel Cron（毎日1回）で呼び出される。
 * expires_at を過ぎた見積書をStorage含め完全削除する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { deleteQuotationFull } from '@/lib/quotation/delete';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron認証: CRON_SECRET が設定されていれば検証
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from('quotations')
    .select('id')
    .lt('expires_at', now);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ deleted: 0, message: '期限切れの見積書はありません' });
  }

  let deleted = 0;
  const errors: string[] = [];

  for (const q of expired) {
    const result = await deleteQuotationFull(supabase, q.id);
    if (result.ok) {
      deleted++;
    } else {
      errors.push(`${q.id}: ${result.error}`);
    }
  }

  console.log(`[cron/cleanup] ${deleted}/${expired.length} 件削除完了`);
  if (errors.length > 0) {
    console.warn('[cron/cleanup] 削除エラー:', errors);
  }

  return NextResponse.json({ deleted, total: expired.length, errors });
}
