'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  quotationId: string;
  label: string;
};

export default function QuotationDeleteButton({ quotationId, label }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    const ok = window.confirm(
      `見積書「${label}」とその全リーフ・商品画像・生成画像を削除します。\n\nこの操作は取り消せません。実行しますか？`,
    );
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/quotations/${quotationId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? '削除に失敗しました');
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={handleDelete}
        disabled={busy}
        className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
      >
        {busy ? '削除中…' : '削除'}
      </button>
      {error && <span className="text-[10px] text-red-500 mt-0.5">{error}</span>}
    </div>
  );
}
