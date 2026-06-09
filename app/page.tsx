/**
 * 画面① — 見積一覧 & 新規取込
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/client';
import UploadForm from '@/components/UploadForm';

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    queued:  { label: 'キュー待機', cls: 'bg-zinc-100 text-zinc-600' },
    running: { label: '処理中',     cls: 'bg-indigo-100 text-indigo-700' },
    done:    { label: '完了',       cls: 'bg-emerald-100 text-emerald-700' },
    error:   { label: 'エラー',     cls: 'bg-red-100 text-red-600' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-600' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function sourceLabel(type: string) {
  return type === 'gsheet' ? 'GSheet' : type.toUpperCase();
}

export default async function QuotationsPage() {
  const supabase = createServerClient();

  const { data: quotations } = await supabase
    .from('quotations')
    .select('*, jobs(id, job_type, status, error_message, created_at)')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-zinc-900">企画業務自動化システム</h1>
            <p className="text-xs text-zinc-500 mt-0.5">ピーナッツクラブ 国内仕入部</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* 新規取込 */}
        <section className="bg-white rounded-xl border border-zinc-200 p-6">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">見積書を取り込む</h2>
          <UploadForm />
        </section>

        {/* 見積一覧 */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            取込済み見積一覧
            {quotations && quotations.length > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-400">{quotations.length}件</span>
            )}
          </h2>
          {!quotations || quotations.length === 0 ? (
            <div className="bg-white rounded-xl border border-zinc-200 p-12 text-center">
              <p className="text-sm text-zinc-400">見積書がまだ取り込まれていません</p>
              <p className="text-xs text-zinc-400 mt-1">上のフォームからExcel・PDFをアップロードしてください</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500 text-xs">種別</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500 text-xs">ファイル名</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500 text-xs">取込日時</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500 text-xs">状態</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500 text-xs">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {quotations.map((q) => {
                    const latestJob = Array.isArray(q.jobs)
                      ? q.jobs.sort((a: { created_at: string }, b: { created_at: string }) =>
                          b.created_at.localeCompare(a.created_at))[0]
                      : q.jobs;
                    const isDone = latestJob?.status === 'done';
                    const isRunning = latestJob?.status === 'running' || latestJob?.status === 'queued';
                    return (
                      <tr key={q.id} className={`hover:bg-zinc-50 transition-colors ${isDone ? '' : 'opacity-75'}`}>
                        <td className="px-4 py-3">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            {sourceLabel(q.source_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-700 text-xs max-w-xs truncate">
                          {q.source_ref ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">
                          {new Date(q.created_at).toLocaleString('ja-JP', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {latestJob ? statusBadge(latestJob.status) : <span className="text-zinc-300 text-xs">—</span>}
                            {isRunning && (
                              <span className="text-xs text-zinc-400 animate-pulse">処理中…</span>
                            )}
                          </div>
                          {latestJob?.error_message && (
                            <p className="text-red-500 text-xs mt-0.5 max-w-xs truncate" title={latestJob.error_message}>
                              {latestJob.error_message}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isDone ? (
                            <div className="flex items-center gap-3">
                              <Link
                                href={`/quotations/${q.id}/products`}
                                className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline"
                              >
                                判定結果
                              </Link>
                              <Link
                                href={`/quotations/${q.id}/leaflets`}
                                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
                              >
                                リーフ編集 →
                              </Link>
                            </div>
                          ) : (
                            <span className="text-zinc-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
