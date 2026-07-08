import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';

type Supabase = SupabaseClient<Database>;
type Job = Database['public']['Tables']['jobs']['Row'];

/**
 * Gmail自動監視の将来拡張ポイント。
 *
 * ここに実装する予定の流れ:
 * 1. Gmail APIで見積候補メールを検索
 * 2. PDF/XLSX/XLS/EML添付とraw EMLを取得
 * 3. ingestGmailEstimateMessage() に渡してSupabase Storageへ保管
 * 4. Gmail側に「処理済み」ラベルを付与し、二重処理を防ぐ
 */
export async function handleGmailScan(job: Job, _supabase: Supabase): Promise<void> {
  console.log(
    `[gmail-scan] Job ${job.id}: Gmail API検索/ラベル付与は未接続です。` +
      ' /api/gmail/ingest から同じ後続処理をテストできます。',
  );
}
