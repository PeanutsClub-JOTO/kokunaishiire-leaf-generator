/**
 * GET /api/cron/ocr-tune
 *
 * Vercel Cron（毎日1回）で呼び出される。
 * OCR精度の低下を検知し、自動チューニングを実行する。
 *
 * フロー:
 * 1. 直近72時間のインポートメトリクスを分析
 * 2. 精度低下を検知した場合、Geminiに改善プロンプトを生成させる
 * 3. ゴールデンテスト（過去の成功ケース）で回帰テストを実行
 * 4. 既存の見積書が壊れないことを確認してから新プロンプトを有効化
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { runAutoTuning } from '@/lib/import/ocr-tuner';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();

  try {
    const result = await runAutoTuning(supabase);
    console.log(`[cron/ocr-tune] ${result.tuned ? '✓ チューニング実施' : '→ スキップ'}: ${result.reason}`);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/ocr-tune] エラー:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
