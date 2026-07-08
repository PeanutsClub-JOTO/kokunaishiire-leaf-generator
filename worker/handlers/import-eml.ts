import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';

type Supabase = SupabaseClient<Database>;
type Job = Database['public']['Tables']['jobs']['Row'];

/**
 * EML取込の将来拡張ポイント。
 *
 * 現段階ではGmail/EML自体を安全に保管し、PDF/XLSX/XLS添付だけ既存取込へ流す。
 * EML単体やEML内のネスト添付展開は、ここに実装する。
 */
export async function handleImportEml(job: Job, supabase: Supabase): Promise<void> {
  if (!job.target_id) {
    console.log('[import-eml] target_id がないため保管のみで完了します。');
    return;
  }

  await supabase
    .from('gmail_estimate_files')
    .update({
      status: 'unsupported',
      error_message: 'EML内添付の自動展開は未実装です。保管済みファイルを確認してください。',
    })
    .eq('id', job.target_id);
}
