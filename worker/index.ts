/**
 * Railway 常駐ワーカー — jobs テーブルポーリング + PDF レンダリングサーバ
 *
 * jobs.status: queued → running → done / error
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: `${__dirname}/../.env.local` });

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/types';
import { handleImportXlsx, loadSettings, processRawSheets } from './handlers/import-xlsx';
import { handleImportPdf } from './handlers/import-pdf';
import { handleImportEml } from './handlers/import-eml';
import { handleGmailScan } from './handlers/gmail-scan';
import { handleRenderLeafletImage } from './handlers/render-leaflet-image';
import { handleExportFinalLeafletToDrive } from './handlers/export-final-leaflet-to-drive';
import { queueLeafletImageJobsForQuotation } from './handlers/queue-leaflet-images';
import { startRendererServer } from './leaf-renderer/render';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[worker] SUPABASE URL/KEY が未設定です。.env.local を確認してください。');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function processJob(job: Database['public']['Tables']['jobs']['Row']): Promise<void> {
  console.log(`[worker] Job ${job.id} (${job.job_type}) 処理開始`);

  const { data: claimed, error: claimErr } = await supabase
    .from('jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();
  if (claimErr) throw new Error(`Job claim failed: ${claimErr.message}`);
  if (!claimed) {
    console.log(`[worker] Job ${job.id} は他のワーカーが処理中のためスキップします`);
    return;
  }

  try {
    switch (job.job_type) {
      case 'import_xlsx':
        await handleImportXlsx(job, supabase);
        if (job.quotation_id) {
          const queued = await queueLeafletImageJobsForQuotation(supabase, job.quotation_id);
          console.log(`[worker] リーフ画像生成ジョブを ${queued} 件キューしました`);
        }
        break;
      case 'import_pdf':
        await handleImportPdf(job, supabase, false);
        if (job.quotation_id) {
          const queued = await queueLeafletImageJobsForQuotation(supabase, job.quotation_id);
          console.log(`[worker] リーフ画像生成ジョブを ${queued} 件キューしました`);
        }
        break;
      case 'import_image_pdf':
        await handleImportPdf(job, supabase, true);
        if (job.quotation_id) {
          const queued = await queueLeafletImageJobsForQuotation(supabase, job.quotation_id);
          console.log(`[worker] リーフ画像生成ジョブを ${queued} 件キューしました`);
        }
        break;
      case 'import_eml':
        await handleImportEml(job, supabase);
        break;
      case 'gmail_scan':
        await handleGmailScan(job, supabase);
        break;
      case 'gmail_ingest_message':
        console.log('[worker] gmail_ingest_message は /api/gmail/ingest 側の処理に委譲します。');
        break;
      case 'import_gsheet': {
        if (!job.quotation_id) throw new Error('import_gsheet job has no quotation_id');

        const { data: q } = await supabase
          .from('quotations')
          .select('source_ref')
          .eq('id', job.quotation_id)
          .single();
        if (!q?.source_ref) throw new Error('Quotation source_ref not found');

        const { importFromGSheet } = await import('../lib/import/gsheet');
        const result = await importFromGSheet(q.source_ref);
        const settings = await loadSettings(supabase);
        // GSheet も xlsx と同じパイプライン（グルーピング・サイジング・リーフ生成）
        await processRawSheets(supabase, job.quotation_id, result.sheets, settings);
        const queued = await queueLeafletImageJobsForQuotation(supabase, job.quotation_id);
        console.log(`[worker] リーフ画像生成ジョブを ${queued} 件キューしました`);
        break;
      }
      case 'render_leaflet_image':
        await handleRenderLeafletImage(job, supabase);
        break;
      case 'export_final_leaflet_to_drive':
        await handleExportFinalLeafletToDrive(job, supabase);
        break;
      case 'generate_pdf':
        // PDFはAPI Route Handler経由でリクエストされるため、このワーカーでは扱わない
        break;
      default:
        console.warn(`[worker] 未知のジョブタイプ: ${job.job_type}`);
    }

    await supabase
      .from('jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), progress: 100 })
      .eq('id', job.id);

    console.log(`[worker] Job ${job.id} 完了`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${job.id} エラー:`, message);

    await supabase
      .from('jobs')
      .update({ status: 'error', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', job.id);
  }
}

async function pollLoop(): Promise<void> {
  while (true) {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(5);

    for (const job of jobs ?? []) {
      await processJob(job);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// PDF レンダリングサーバ起動
startRendererServer();

// ジョブポーリング開始
console.log('[worker] ジョブポーリング開始');
pollLoop().catch((err) => {
  console.error('[worker] ポーリングループ致命的エラー:', err);
  process.exit(1);
});
