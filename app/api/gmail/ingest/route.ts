/**
 * POST /api/gmail/ingest
 *
 * Gmail API / webhook / 手動テストから渡されたメール情報をアーカイブし、
 * PDF/XLSX/XLS 添付を既存の見積取込ジョブへ流す入口。
 *
 * ここではGmailへの接続・検索・ラベル付けは行わない。
 * それらは後続の gmail_scan ジョブまたは外部Gmail連携から呼び出す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import {
  ingestGmailEstimateMessage,
  type GmailEstimateMessageInput,
} from '@/lib/gmail/estimate-ingest';

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = (await req.json()) as GmailEstimateMessageInput;

  if (!body.gmailMessageId) {
    return NextResponse.json({ error: 'gmailMessageId is required' }, { status: 400 });
  }

  try {
    const result = await ingestGmailEstimateMessage(supabase, body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
