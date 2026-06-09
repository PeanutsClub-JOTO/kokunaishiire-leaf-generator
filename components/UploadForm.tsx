'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type JobStatus = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'error';

export default function UploadForm() {
  const [status, setStatus] = useState<JobStatus>('idle');
  const [message, setMessage] = useState('');
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gsheetRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function pollJob(jobId: string, qId: string) {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(`/api/jobs/${jobId}`);
      const { job } = await res.json();
      if (job.status === 'done') {
        setStatus('done');
        setMessage('取込完了');
        router.push(`/quotations/${qId}/products`);
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

    const res = await fetch('/api/quotations', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) { setStatus('error'); setMessage(data.error ?? 'エラー'); return; }

    setQuotationId(data.quotation_id);
    setStatus('queued');
    setMessage('取込キューに登録しました。処理中...');
    pollJob(data.job_id, data.quotation_id);
  }

  async function submitGSheet(e: React.FormEvent) {
    e.preventDefault();
    const url = gsheetRef.current?.value?.trim();
    if (!url) { setMessage('スプレッドシートのURLまたはIDを入力してください'); return; }

    setStatus('uploading');
    setMessage('リクエスト送信中...');

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
    pollJob(data.job_id, data.quotation_id);
  }

  const busy = ['uploading', 'queued', 'running'].includes(status);

  return (
    <div className="space-y-6">
      {/* ファイルアップロード */}
      <form onSubmit={submitFile} className="bg-white rounded-xl border border-zinc-200 p-6 space-y-4">
        <h3 className="font-semibold text-zinc-800">Excel / PDF アップロード</h3>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.pdf"
          disabled={busy}
          className="block w-full text-sm text-zinc-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          アップロード
        </button>
      </form>

      {/* Google Sheets */}
      <form onSubmit={submitGSheet} className="bg-white rounded-xl border border-zinc-200 p-6 space-y-4">
        <h3 className="font-semibold text-zinc-800">Google スプレッドシート取込</h3>
        <input
          ref={gsheetRef}
          type="text"
          placeholder="スプレッドシートのURL または ID"
          disabled={busy}
          className="block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          取込
        </button>
      </form>

      {/* ステータス表示 */}
      {status !== 'idle' && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          status === 'done'
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-indigo-50 text-indigo-700'
        }`}>
          {busy && <span className="mr-2 animate-spin inline-block">⏳</span>}
          {message || statusLabel(status)}
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
