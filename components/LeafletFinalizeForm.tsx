'use client';
import { useState } from 'react';

type Props = {
  leafletId: string;
  initialProductCode: string | null;
  initialPjNo: string | null;
  initialLeafName: string | null;
  initialLeadTime: string | null;
  initialLeafImageUrl: string | null;
  currentStatus: 'draft' | 'final';
};

export default function LeafletFinalizeForm({
  leafletId,
  initialProductCode,
  initialPjNo,
  initialLeafName,
  initialLeadTime,
  initialLeafImageUrl,
  currentStatus,
}: Props) {
  const [productCode, setProductCode] = useState(initialProductCode ?? '');
  const [pjNo, setPjNo] = useState(initialPjNo ?? '');
  const [leafName, setLeafName] = useState(initialLeafName ?? '');
  const [leadTime, setLeadTime] = useState(initialLeadTime ?? '受注後約1週間');
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [leafImageUrl, setLeafImageUrl] = useState<string | null>(initialLeafImageUrl);
  const [message, setMessage] = useState('');

  async function saveLeaflet(finalize = false): Promise<boolean> {
    const body: Record<string, string> = {
      product_code: productCode,
      pj_no: pjNo,
      leaf_name: leafName,
      lead_time: leadTime,
    };
    if (finalize) body.status = 'final';

    const res = await fetch(`/api/leaflets/${leafletId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? '保存エラー');
      return false;
    }
    if (finalize) setStatus('final');
    setMessage('保存しました');
    return true;
  }

  async function handleSave(finalize = false) {
    setSaving(true);
    setMessage('');
    try {
      await saveLeaflet(finalize);
    } catch (err) {
      setMessage(err instanceof Error ? `保存エラー: ${err.message}` : '保存エラー');
    } finally {
      setSaving(false);
    }
  }

  async function handleGeneratePdf() {
    setSaving(true);
    setMessage('PDF生成中...');
    try {
      // まず保存
      const saved = await saveLeaflet(false);
      if (!saved) return;

      const res = await fetch(`/api/leaflets/${leafletId}/pdf`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error ?? 'PDF生成エラー'); return; }
      setPdfUrl(data.pdf_url);
      setMessage('PDF生成完了');
    } catch (err) {
      setMessage(err instanceof Error ? `PDF生成エラー: ${err.message}` : 'PDF生成エラー');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateImage() {
    setSaving(true);
    setMessage('リーフ画像生成ジョブを登録中...');
    try {
      const saved = await saveLeaflet(false);
      if (!saved) return;

      const res = await fetch(`/api/leaflets/${leafletId}/image`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error ?? 'リーフ画像生成ジョブ登録エラー'); return; }

      setMessage('リーフ画像生成中...');
      const jobId = data.job_id as string;
      let failureCount = 0;
      for (let i = 0; i < 45; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobRes = await fetch(`/api/jobs/${jobId}`);
        const jobData = await jobRes.json().catch(() => ({}));
        if (!jobRes.ok || !jobData.job) {
          failureCount++;
          if (failureCount >= 3) {
            setMessage(jobData.error ?? 'ジョブ確認エラー');
            return;
          }
          setMessage('ジョブ状態を再確認中...');
          continue;
        }
        failureCount = 0;
        if (jobData.job.status === 'error') {
          setMessage(jobData.job.error_message ?? 'リーフ画像生成エラー');
          return;
        }
        if (jobData.job.status === 'done') {
          const leafRes = await fetch(`/api/leaflets/${leafletId}`);
          const leafData = await leafRes.json();
          if (leafRes.ok) {
            setLeafImageUrl(leafData.leaflet.leaf_image_url ?? null);
          }
          setMessage('リーフ画像生成完了');
          return;
        }
      }
      setMessage('リーフ画像生成を受け付けました。少し後に画面を更新してください');
    } catch (err) {
      setMessage(err instanceof Error ? `リーフ画像生成エラー: ${err.message}` : 'リーフ画像生成エラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium text-zinc-700">品名（リーフ表示用）</span>
          <input
            type="text"
            value={leafName}
            onChange={(e) => setLeafName(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-zinc-700">商品コード</span>
          <input
            type="text"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="例: ABC-001（末尾に$で直送）"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-zinc-700">PJ番号</span>
          <input
            type="text"
            value={pjNo}
            onChange={(e) => setPjNo(e.target.value)}
            placeholder="担当者ID等"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-zinc-700">納期</span>
          <input
            type="text"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-zinc-300 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={handleGenerateImage}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
        >
          リーフ画像生成
        </button>
        <button
          onClick={handleGeneratePdf}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          PDF生成
        </button>
        {status === 'draft' && (
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !productCode || !pjNo}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            正式確定
          </button>
        )}
        {status === 'final' && (
          <span className="inline-flex items-center px-3 py-2 rounded-lg bg-emerald-100 text-emerald-700 text-sm font-medium">
            ✓ 正式確定済み
          </span>
        )}
      </div>

      {message && (
        <p className="text-sm text-indigo-600">{message}</p>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 text-white px-4 py-2 text-sm font-medium hover:bg-zinc-700"
        >
          PDFを開く →
        </a>
      )}

      {leafImageUrl && (
        <a
          href={leafImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-700 text-white px-4 py-2 text-sm font-medium hover:bg-amber-600"
        >
          リーフ画像を開く →
        </a>
      )}
    </div>
  );
}
