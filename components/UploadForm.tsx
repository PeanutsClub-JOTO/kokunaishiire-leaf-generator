'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type JobStatus = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'error';
type JobResponse = {
  job?: {
    status: Exclude<JobStatus, 'idle' | 'uploading'>;
    error_message?: string | null;
  };
  error?: string;
};

export default function UploadForm() {
  const [status, setStatus] = useState<JobStatus>('idle');
  const [message, setMessage] = useState('');
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gsheetRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function pollJob(jobId: string, qId: string) {
    const maxAttempts = 60;
    let failureCount = 0;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      let job: JobResponse['job'];
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = (await res.json().catch(() => ({}))) as JobResponse;
        if (!res.ok || !data.job) {
          throw new Error(data.error ?? 'ジョブ状態を取得できませんでした');
        }
        job = data.job;
        failureCount = 0;
      } catch (err) {
        failureCount++;
        if (failureCount >= 3) {
          setStatus('error');
          setMessage(
            err instanceof Error
              ? `状態確認エラー: ${err.message}`
              : '状態確認エラーが発生しました',
          );
          return;
        }
        setMessage('状態確認を再試行中...');
        continue;
      }

      if (job.status === 'done') {
        setStatus('done');
        setMessage('取込完了！リーフ編集画面へ移動します...');
        router.push(`/quotations/${qId}/leaflets`);
        return;
      }
      if (job.status === 'error') {
        setStatus('error');
        setMessage(`取込エラー: ${job.error_message ?? '不明なエラー'}`);
        return;
      }
      setStatus(job.status);
    }
    setStatus('error');
    setMessage('タイムアウト: ワーカーからの応答がありません');
  }

  async function submitFile(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setMessage('ファイルを選択してください'); return; }

    setStatus('uploading');
    setMessage('アップロード中...');

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/quotations', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) { setStatus('error'); setMessage(data.error ?? 'エラー'); return; }

      setQuotationId(data.quotation_id);
      setStatus('queued');
      setMessage('取込キューに登録しました。処理中...');
      void pollJob(data.job_id, data.quotation_id);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? `アップロードエラー: ${err.message}` : 'アップロードエラー');
    }
  }

  async function submitGSheet(e: React.FormEvent) {
    e.preventDefault();
    const url = gsheetRef.current?.value?.trim();
    if (!url) { setMessage('スプレッドシートのURLまたはIDを入力してください'); return; }

    setStatus('uploading');
    setMessage('リクエスト送信中...');

    try {
      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_ref: url }),
      });
      const data = await res.json();

      if (!res.ok) { setStatus('error'); setMessage(data.error ?? 'エラー'); return; }

      setQuotationId(data.quotation_id);
      setStatus('queued');
      setMessage('取込キューに登録しました。処理中...');
      void pollJob(data.job_id, data.quotation_id);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? `取込リクエストエラー: ${err.message}` : '取込リクエストエラー');
    }
  }

  const busy = ['uploading', 'queued', 'running'].includes(status);

  return (
    <div className="space-y-5">
      {/* Excel / PDF アップロード */}
      <form onSubmit={submitFile} className="space-y-3">
        <label className="block text-xs font-medium text-zinc-500">Excel / PDF（.xlsx .xls .pdf）</label>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.pdf"
            disabled={busy}
            className="flex-1 text-sm text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 disabled:opacity-50 cursor-pointer"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            取り込む
          </button>
        </div>
      </form>

      {/* 区切り */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-200" />
        <span className="text-xs text-zinc-400">または</span>
        <div className="flex-1 h-px bg-zinc-200" />
      </div>

      {/* Google Sheets */}
      <form onSubmit={submitGSheet} className="space-y-3">
        <label className="block text-xs font-medium text-zinc-500">Google スプレッドシート URL</label>
        <div className="flex items-center gap-3">
          <input
            ref={gsheetRef}
            type="text"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            disabled={busy}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            取り込む
          </button>
        </div>
      </form>

      {/* ステータス表示 */}
      {status !== 'idle' && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
          status === 'done'
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-indigo-50 text-indigo-700'
        }`}>
          {busy && (
            <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          )}
          <span>{message || statusLabel(status)}</span>
        </div>
      )}
    </div>
  );
}

function statusLabel(s: JobStatus): string {
  switch (s) {
    case 'uploading': return 'アップロード中...';
    case 'queued':    return 'キュー待機中...';
    case 'running':   return '処理中...';
    case 'done':      return '完了';
    case 'error':     return 'エラーが発生しました';
    default:          return '';
  }
}
