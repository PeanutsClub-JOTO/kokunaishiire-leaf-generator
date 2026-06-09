/**
 * 画面② — 判定結果一覧
 * シートごとに商品を表示し、通過/除外フラグを可視化する
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/client';
import type { Product } from '@/lib/supabase/types';

const FLAG_LABELS: Record<string, { label: string; color: string }> = {
  cost_over:            { label: 'コスト超過',     color: 'text-red-600 bg-red-50' },
  'unit_price>cap':     { label: '単価超過',       color: 'text-red-600 bg-red-50' },
  'shelf<min':          { label: '賞味期限不足',   color: 'text-red-600 bg-red-50' },
  sales_out_of_range:   { label: '販売期間外',     color: 'text-red-600 bg-red-50' },
  unit_near_cap:        { label: '単価上限近い',   color: 'text-amber-600 bg-amber-50' },
  wholesale_over:       { label: '卸価格高め',     color: 'text-amber-600 bg-amber-50' },
  shelf_near:           { label: '賞味期限注意',   color: 'text-amber-600 bg-amber-50' },
  spec_parse_error:     { label: '規格パースエラー', color: 'text-zinc-500 bg-zinc-50' },
  irisu_parse_error:    { label: '入数パースエラー', color: 'text-zinc-500 bg-zinc-50' },
  minlot_parse_error:   { label: 'ロットパースエラー', color: 'text-zinc-500 bg-zinc-50' },
  low_extract_conf:     { label: 'AI抽出精度低',   color: 'text-amber-600 bg-amber-50' },
};

function flagBadge(code: string) {
  const info = FLAG_LABELS[code] ?? { label: code, color: 'text-zinc-500 bg-zinc-50' };
  return (
    <span key={code} className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${info.color}`}>
      {info.label}
    </span>
  );
}

const FAIL_FLAGS = new Set(['cost_over', 'unit_price>cap', 'shelf<min', 'sales_out_of_range']);

type PageProps = { params: Promise<{ id: string }> };

export default async function ProductsPage({ params }: PageProps) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data: quotation } = await supabase
    .from('quotations')
    .select('id, source_ref, source_type')
    .eq('id', id)
    .single();
  if (!quotation) notFound();

  // シート + 商品（alert_flagsは別途取得）
  const { data: sheets } = await supabase
    .from('sheets')
    .select('id, sheet_name, maker_name, products(id, no, product_name, maker_name, spec_raw, irisu_raw, min_lot_qty, cost, retail_price, jan_code, shelf_life_days, sales_period_raw, image_url)')
    .eq('quotation_id', id)
    .order('created_at');

  const allProducts = (sheets ?? []).flatMap((s) => (s.products ?? []) as Product[]);
  const productIds = allProducts.map((p) => p.id);

  // alert_flags を別途取得（ポリモーフィック関係）
  const flagsMap = new Map<string, { flag_code: string; message: string | null }[]>();
  if (productIds.length > 0) {
    const { data: flags } = await supabase
      .from('alert_flags')
      .select('target_id, flag_code, message')
      .eq('target_type', 'product')
      .in('target_id', productIds);
    for (const f of flags ?? []) {
      const arr = flagsMap.get(f.target_id) ?? [];
      arr.push({ flag_code: f.flag_code, message: f.message });
      flagsMap.set(f.target_id, arr);
    }
  }

  const passCount = allProducts.filter(
    (p) => !(flagsMap.get(p.id) ?? []).some((f) => FAIL_FLAGS.has(f.flag_code)),
  ).length;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-zinc-200 px-6 py-4">
        <nav className="flex items-center gap-1.5 text-xs text-zinc-400 mb-2">
          <Link href="/" className="hover:text-zinc-700 transition-colors">見積一覧</Link>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-600 font-medium">判定結果</span>
        </nav>
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-zinc-900 leading-tight">{quotation.source_ref ?? quotation.id}</h1>
            <div className="flex items-center gap-3 mt-1.5 text-sm">
              <span className="text-zinc-500">全 <b className="text-zinc-800">{allProducts.length}</b> 品</span>
              <span className="text-emerald-600 font-medium">通過 {passCount}品</span>
              <span className="text-red-500 font-medium">除外 {allProducts.length - passCount}品</span>
            </div>
          </div>
          <Link
            href={`/quotations/${id}/assort`}
            className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
          >
            アソート構成へ →
          </Link>
        </div>
      </header>

      <main className="px-6 py-6 space-y-8">
        {(sheets ?? []).map((sheet) => (
          <section key={sheet.id}>
            <h2 className="text-sm font-semibold text-zinc-600 mb-3 flex items-center gap-2">
              <span className="bg-zinc-200 rounded px-2 py-0.5">{sheet.sheet_name ?? 'Sheet'}</span>
              {sheet.maker_name && <span className="text-zinc-500">{sheet.maker_name}</span>}
            </h2>
            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    {['No.', '品名', '規格', '入数', '原価', '最小ロット', '賞味期限', 'フラグ', '判定'].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-medium text-zinc-500 text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {((sheet.products ?? []) as Product[]).map((p) => {
                    const flags = flagsMap.get(p.id) ?? [];
                    const isFail = flags.some((f) => FAIL_FLAGS.has(f.flag_code));
                    return (
                      <tr key={p.id} className={`${isFail ? 'bg-red-50/30' : ''} hover:bg-zinc-50`}>
                        <td className="px-3 py-2.5 text-zinc-400 text-xs">{p.no ?? '—'}</td>
                        <td className="px-3 py-2.5 text-zinc-800 font-medium max-w-[180px]">
                          <div className="truncate">{p.product_name ?? '—'}</div>
                          {p.maker_name && <div className="text-xs text-zinc-400 truncate">{p.maker_name}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-600 text-xs">{p.spec_raw ?? '—'}</td>
                        <td className="px-3 py-2.5 text-zinc-600 text-xs">{p.irisu_raw ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right text-zinc-700">
                          {p.cost != null ? `¥${p.cost.toLocaleString()}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-zinc-700">{p.min_lot_qty ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right text-zinc-700">
                          {p.shelf_life_days != null ? `${p.shelf_life_days}日` : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {flags.map((f) => flagBadge(f.flag_code))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-lg">{isFail ? '❌' : '✅'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {!sheets || sheets.length === 0 ? (
          <div className="text-center py-16 text-zinc-400">
            <p>商品データがまだ取り込まれていません。</p>
            <p className="text-sm mt-1">ワーカーの処理が完了するまでお待ちください。</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
