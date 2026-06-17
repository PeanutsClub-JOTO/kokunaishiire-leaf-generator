'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ─── 型 ───────────────────────────────────────────────────────────────────────
export type WorkbenchItem = {
  productId: string;
  ratio: number;
  no: number | null;
  productName: string;
  imageUrl: string | null;
  pieceSize: string | null;
  janCode: string | null;
  cost: number;
  minLotQty: number;
};

export type WorkbenchLeaflet = {
  id: string;
  groupId: string;
  groupKey: string;
  isSingle: boolean;
  status: 'draft' | 'final';
  leafName: string;
  itemCount: number;
  leafQty: number;
  costTotal: number;
  wholesalePrice: number;
  unitPrice: number;
  isHalfOk: boolean;
  leadTime: string;
  shelfLifeDays: number | null;
  leafImageUrl: string | null;
  renderStatus: string;
  note: string | null;
  items: WorkbenchItem[];
};

type Props = {
  quotationId: string;
  leaflets: WorkbenchLeaflet[];
  templateHtml: string;
};

const SETTINGS = { unitPriceCap: 1000, costCap: 33000, halfBase: 16500 };

// ─── クライアント側サイジング（lib/calc/sizing-v2 と同ロジック） ───────────────
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function lcm(a: number, b: number): number { return a <= 0 || b <= 0 ? Math.max(a, b, 1) : (a / gcd(a, b)) * b; }
function ceil100(n: number): number { return Math.ceil(n / 100) * 100; }

type Sizing = { ok: boolean; reason?: string; setCost: number; unitPrice: number; leafQty: number; costTotal: number; isHalfOk: boolean };

function calcSizing(items: WorkbenchItem[]): Sizing {
  const types = items.map((i) => ({ cost: i.cost, minLotQty: i.minLotQty, ratio: i.ratio }));
  const setCost = types.reduce((a, t) => a + t.cost * t.ratio, 0);
  const setBoxes = types.reduce((a, t) => a + t.ratio, 0);
  const itemCount = types.length;
  const baseFail = (reason: string): Sizing => ({ ok: false, reason, setCost, unitPrice: itemCount ? setCost / itemCount : 0, leafQty: 0, costTotal: 0, isHalfOk: false });
  if (setCost <= 0 || setBoxes <= 0) return baseFail('no_cost');
  if (setCost > SETTINGS.unitPriceCap) return baseFail('unit_over');
  let step = 1;
  for (const t of types) step = lcm(step, Math.max(t.ratio > 0 ? Math.ceil(t.minLotQty / t.ratio) : t.minLotQty, 1));
  const lotPrice = setCost * step;
  if (lotPrice > SETTINGS.costCap) return baseFail('cost_over');
  const maxSets = Math.floor(SETTINGS.costCap / setCost);
  const sets = Math.floor(maxSets / step) * step;
  if (sets < step) return baseFail('cost_over');
  const unitPrice = setCost / itemCount;
  const leafQty = sets * itemCount;
  return { ok: true, setCost, unitPrice, leafQty, costTotal: ceil100(unitPrice * leafQty), isHalfOk: lotPrice <= SETTINGS.halfBase };
}

// ─── キャッチコピー生成（lib/leaf/generate-image と同ロジック簡易版） ──────────
const COPY_CATS: Array<[RegExp, string]> = [
  [/ポップコーン/, 'ポップコーン'], [/水羊羹|水ようかん/, '水羊羹'], [/羊羹|ようかん/, '羊羹'],
  [/カステラ/, 'カステラ'], [/バウム/, 'バウムクーヘン'], [/ケーキ/, 'ケーキ'], [/クッキー/, 'クッキー'],
  [/ムース/, 'ムース'], [/プリン/, 'プリン'], [/ゼリー/, 'ゼリー'], [/最中|もなか/, '最中'],
  [/まんじゅう|饅頭/, 'まんじゅう'], [/せんべい|煎餅/, 'せんべい'], [/チョコ|ショコラ/, 'チョコ'], [/グミ/, 'グミ'],
];
function detectCat(n: string): string { for (const [re, l] of COPY_CATS) if (re.test(n)) return l; return '商品'; }
function flavorOf(n: string): string {
  let s = (n ?? '').trim().replace(/^[0-9A-Za-zＡ-Ｚ＿\-－]+[PpＰ]?(?=[ぁ-んァ-ヶ一-龠])/, '');
  s = s.replace(/(ギフト|ｷﾞﾌﾄ|詰合せ|詰め合わせ|セット)$/g, '');
  for (const [re] of COPY_CATS) s = s.replace(new RegExp(`(?:${re.source})$`), '');
  return s.trim();
}
function mainCopy(items: WorkbenchItem[]): string {
  if (items.length >= 2) {
    const cats = Array.from(new Set(items.map((p) => detectCat(p.productName))));
    const cat = cats.length === 1 && cats[0] !== '商品' ? cats[0] : '味';
    return `${items.length}種類の${cat}が一度に楽しめる、\nアソート企画です！`;
  }
  const n = items[0]?.productName ?? '', cat = detectCat(n), fl = flavorOf(n);
  if (fl && cat !== '商品') return `${fl}の${cat}が楽しめる、\n景品向けの商品です！`;
  return fl ? `${fl}！` : `${n}です！`;
}
function salesCopy(items: WorkbenchItem[]): string {
  if (items.length >= 2) {
    const fls = items.map((p) => flavorOf(p.productName) || p.productName).filter(Boolean);
    return `${fls.slice(0, 4).join('・')}${fls.length > 4 ? ' ほか' : ''}の\n${items.length}種アソートです。`;
  }
  const fl = flavorOf(items[0]?.productName ?? ''), cat = detectCat(items[0]?.productName ?? '');
  return fl ? `${fl}の${cat}。\n景品向けにおすすめの商品です。` : '景品向けにおすすめの商品です。';
}
function selectTheme(name: string): { cls: string; label: string } {
  if (/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|最中|まんじゅう|饅頭|どら焼|団子|大福|あられ|せんべい|煎餅|カステラ|金澤|金沢/.test(name)) return { cls: 'theme-wagashi', label: '和菓子' };
  if (/ポップコーン|スナック|ポテト|チップ|コーン|ナッツ|しお味|塩味/.test(name)) return { cls: 'theme-snack', label: 'スナック' };
  if (/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|ワッフル|ラスク|キャンディ|飴|グミ/.test(name)) return { cls: 'theme-sweets', label: 'スイーツ' };
  if (/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|ラムネ|ミント|乳酸/.test(name)) return { cls: 'theme-cool', label: 'さっぱり' };
  if (/マンゴー|ゼリー|フルーツ|果|桃|みかん|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|梨|メロン|キウイ|さくらんぼ/.test(name)) return { cls: 'theme-fruit', label: 'フルーツ' };
  return { cls: 'theme-standard', label: 'おすすめ' };
}

const esc = (v: string) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
function sizeMm(d: string | null): string {
  if (!d) return '—';
  const s = String(d).replace(/[WＷ]/g, '').replace(/[DＤHＨ]/g, '×').replace(/×+/g, '×').replace(/^×|×$/g, '');
  return /[a-zA-Z]/.test(s) ? s : `${s}mm`;
}

// テンプレートにデータを差し込んで HTML を生成
function buildHtml(tpl: string, leaf: WorkbenchLeaflet, items: WorkbenchItem[], sizing: Sizing): string {
  const leafName = items.map((i) => i.productName).join('・');
  const theme = selectTheme(leafName);
  const imgs = items.map((i) => i.imageUrl).filter(Boolean) as string[];
  const isAssort = items.length > 1;
  const hero = isAssort
    ? `<div class="assort-grid">${imgs.slice(0, 4).map((s) => `<img src="${esc(s)}" alt="" />`).join('')}</div>`
    : imgs[0] ? `<img class="hero-image" src="${esc(imgs[0])}" alt="" />` : '<div class="image-placeholder">商品画像未設定</div>';
  const pieceSize = items[0]?.pieceSize ?? null;
  return tpl
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{AI_BG_STYLE}}', '') // ライブプレビューはCSSテーマのみ
    .replaceAll('{{THEME_CLASS}}', theme.cls)
    .replaceAll('{{THEME_LABEL}}', esc(theme.label))
    .replaceAll('{{MAIN_COPY}}', esc(mainCopy(items)))
    .replaceAll('{{SALES_COPY}}', esc(leaf.note?.trim() ? leaf.note : salesCopy(items)))
    .replaceAll('{{ASSORT_CLASS}}', isAssort ? 'assort' : '')
    .replaceAll('{{HERO_IMAGE_HTML}}', hero)
    .replaceAll('{{SUB_IMAGE_HTML}}', imgs[0] ? `<img src="${esc(imgs[0])}" alt="" />` : '')
    .replaceAll('{{DRAFT_CLASS}}', '')
    .replaceAll('{{STATUS_LABEL}}', '')
    .replaceAll('{{STATUS_NOTE}}', '')
    .replaceAll('{{PRODUCT_CODE}}', '')
    .replaceAll('{{LEAF_NAME}}', esc(leaf.leafName || leafName))
    .replaceAll('{{ITEM_COUNT}}', fmt(items.length))
    .replaceAll('{{LEAF_QTY}}', fmt(sizing.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', fmt(sizing.costTotal))
    .replaceAll('{{UNIT_PRICE}}', fmt(sizing.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', esc(sizeMm(pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', leaf.shelfLifeDays != null ? fmt(leaf.shelfLifeDays) : '—')
    .replaceAll('{{LEAD_TIME}}', esc(leaf.leadTime || '受注後約1週間'))
    .replaceAll('{{HALF_LABEL}}', sizing.isHalfOk ? '可' : '不可')
    .replaceAll('{{PJ_NO}}', '');
}

// ─── コンポーネント ────────────────────────────────────────────────────────────
export default function LeafletWorkbench({ quotationId, leaflets, templateHtml }: Props) {
  void quotationId;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(leaflets[0]?.id ?? '');
  const [edits, setEdits] = useState<Record<string, { leafName: string; leadTime: string; note: string }>>(() =>
    Object.fromEntries(leaflets.map((l) => [l.id, { leafName: l.leafName, leadTime: l.leadTime, note: l.note ?? '' }])),
  );
  // アソート選択: ベースリーフID → { productId: ratio }（ベース商品を必ず含む）
  const [assortSel, setAssortSel] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(leaflets.map((l) => [l.id, Object.fromEntries(l.items.map((it) => [it.productId, it.ratio]))])),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selected = leaflets.find((l) => l.id === selectedId) ?? leaflets[0];
  const edit = edits[selected.id];
  const sel = assortSel[selected.id];

  // 全商品の参照マップ（productId → 商品情報）
  const productById = useMemo(() => {
    const m = new Map<string, WorkbenchItem>();
    for (const l of leaflets) for (const it of l.items) if (!m.has(it.productId)) m.set(it.productId, it);
    return m;
  }, [leaflets]);

  // アソート可能な仲間（同じ group_key・single:でない・自分以外）
  const compatItems = useMemo<WorkbenchItem[]>(() => {
    if (selected.groupKey.startsWith('single:')) return [];
    const seen = new Set(selected.items.map((it) => it.productId));
    const out: WorkbenchItem[] = [];
    for (const l of leaflets) {
      if (l.id === selected.id || l.groupKey !== selected.groupKey) continue;
      for (const it of l.items) if (!seen.has(it.productId)) { seen.add(it.productId); out.push(it); }
    }
    return out;
  }, [leaflets, selected]);

  // 現在の選択を反映したアソート構成アイテム
  const editedItems = useMemo<WorkbenchItem[]>(
    () => Object.entries(sel).map(([pid, ratio]) => ({ ...(productById.get(pid) as WorkbenchItem), ratio })),
    [sel, productById],
  );
  const isAssort = editedItems.length > 1;
  const sizing = useMemo(() => calcSizing(editedItems), [editedItems]);
  const leafForPreview = useMemo<WorkbenchLeaflet>(
    () => ({ ...selected, leafName: edit.leafName, leadTime: edit.leadTime, note: edit.note, isSingle: !isAssort }),
    [selected, edit, isAssort],
  );
  const previewHtml = useMemo(
    () => buildHtml(templateHtml, leafForPreview, editedItems, sizing),
    [templateHtml, leafForPreview, editedItems, sizing],
  );

  function patchEdit(patch: Partial<{ leafName: string; leadTime: string; note: string }>) {
    setEdits((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], ...patch } }));
  }
  function setRatio(productId: string, ratio: number) {
    setAssortSel((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], [productId]: ratio } }));
  }
  function toggleCompat(item: WorkbenchItem, on: boolean) {
    setAssortSel((prev) => {
      const cur = { ...prev[selected.id] };
      if (on) cur[item.productId] = 1;
      else delete cur[item.productId];
      return { ...prev, [selected.id]: cur };
    });
  }

  // 単品リーフの情報を保存
  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      await fetch(`/api/leaflets/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaf_name: edit.leafName, lead_time: edit.leadTime, note: edit.note }),
      });
      setMessage('保存しました');
      router.refresh();
    } catch {
      setMessage('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  // アソート作成＋そのまま画像生成（選択商品から新リーフを作る）
  async function handleCreateAssort() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/assort/from-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetGroupId: selected.groupId,
          items: editedItems.map((it) => ({ product_id: it.productId, ratio: it.ratio })),
          leaf_name: edit.leafName,
          lead_time: edit.leadTime,
          note: edit.note,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'アソート作成に失敗しました');
        return;
      }
      // 作成された新リーフに対して画像生成を依頼
      if (data.leaflet?.id) {
        await fetch(`/api/leaflets/${data.leaflet.id}/image`, { method: 'POST' });
      }
      setMessage('アソートリーフを作成し、画像生成を依頼しました。');
      router.refresh();
    } catch {
      setMessage('アソート作成に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateImage() {
    setSaving(true);
    setMessage('画像生成をリクエストしました（ワーカー処理）');
    try {
      await fetch(`/api/leaflets/${selected.id}/image`, { method: 'POST' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-92px)]">
      {/* 左: リーフ一覧（ギャラリー） */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-3 space-y-2">
        {leaflets.map((l) => {
          const active = l.id === selectedId;
          return (
            <button
              key={l.id}
              onClick={() => setSelectedId(l.id)}
              className={`w-full text-left rounded-lg border p-2 transition ${active ? 'border-indigo-400 bg-white ring-1 ring-indigo-300' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}
            >
              <div className="aspect-[16/10] w-full overflow-hidden rounded bg-zinc-100 flex items-center justify-center">
                {l.leafImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.leafImageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-zinc-400">未生成</span>
                )}
              </div>
              <div className="mt-1.5 truncate text-xs font-medium text-zinc-800">{l.leafName}</div>
              <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                <span className={`rounded px-1 ${l.isSingle ? 'bg-zinc-100' : 'bg-amber-100 text-amber-700'}`}>
                  {l.isSingle ? '単品' : `アソート${l.itemCount}種`}
                </span>
                <span>単価{fmt(l.unitPrice)}円</span>
              </div>
            </button>
          );
        })}
      </aside>

      {/* 中央: ライブプレビュー */}
      <main className="flex-1 overflow-auto bg-zinc-100 p-6">
        <div className="mx-auto" style={{ width: 770 }}>
          <div className="overflow-hidden rounded-lg shadow-lg" style={{ width: 770, height: 485 }}>
            <iframe
              title="leaf-preview"
              srcDoc={previewHtml}
              style={{ width: 1540, height: 970, border: 0, transform: 'scale(0.5)', transformOrigin: 'top left' }}
            />
          </div>
          {!sizing.ok && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              この構成は企画対象外です（{sizing.reason === 'unit_over' ? '単価合計が1,000円超' : sizing.reason === 'cost_over' ? '最小ロットが33,000円超' : sizing.reason}）。比率を調整してください。
            </div>
          )}
        </div>
      </main>

      {/* 右: 編集パネル */}
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">掲載品名</label>
          <textarea
            value={edit.leafName}
            onChange={(e) => patchEdit({ leafName: e.target.value })}
            rows={2}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">セールスコピー（空欄なら自動生成）</label>
          <textarea
            value={edit.note}
            onChange={(e) => patchEdit({ note: e.target.value })}
            rows={3}
            placeholder={salesCopy(editedItems)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">受注後納期</label>
          <input
            value={edit.leadTime}
            onChange={(e) => patchEdit({ leadTime: e.target.value })}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        {/* アソート可能な仲間（複数選択でアソート化） */}
        {compatItems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="block text-xs font-semibold text-amber-700 mb-2">
              ＋ 他の種類もアソートできます（{compatItems.length}種）
            </label>
            <div className="space-y-1.5">
              {compatItems.map((it) => {
                const checked = it.productId in sel;
                const wouldExceed = !checked && (sizing.setCost + it.cost) > SETTINGS.unitPriceCap;
                return (
                  <label key={it.productId} className={`flex items-center gap-2 text-xs ${wouldExceed ? 'opacity-40' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={wouldExceed}
                      onChange={(e) => toggleCompat(it, e.target.checked)}
                    />
                    <span className="truncate flex-1 text-zinc-700">{it.productName}</span>
                    <span className="text-zinc-400">{fmt(it.cost)}円</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-amber-600">単価合計が1,000円以内になる組み合わせのみ選べます</p>
          </div>
        )}

        {/* アソート比率スライダー（2種以上選択時） */}
        {isAssort && (
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-2">アソート比率</label>
            <div className="space-y-2">
              {editedItems.map((it) => (
                <div key={it.productId} className="text-xs">
                  <div className="flex justify-between text-zinc-600 mb-0.5">
                    <span className="truncate pr-2">{it.productName}</span>
                    <span className="font-medium">×{it.ratio}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={it.ratio}
                    onChange={(e) => setRatio(it.productId, parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 計算結果（ライブ） */}
        <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm space-y-1">
          <Row label="単価" value={`${fmt(sizing.unitPrice)}円`} warn={sizing.unitPrice > SETTINGS.unitPriceCap} />
          <Row label="入数" value={`${fmt(sizing.leafQty)}個`} />
          <Row label="卸価格" value={`${fmt(sizing.costTotal)}円`} />
          <Row label="ハーフ" value={sizing.isHalfOk ? '可' : '不可'} />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {isAssort ? (
            // アソート選択中: 作成＋画像生成を一括
            <button onClick={handleCreateAssort} disabled={saving || !sizing.ok}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '処理中…' : 'この組み合わせでアソート作成＋画像生成'}
            </button>
          ) : (
            // 単品: 情報保存 と 画像生成を分離
            <>
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? '処理中…' : '情報を保存'}
              </button>
              <button onClick={handleGenerateImage} disabled={saving || !sizing.ok}
                className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                リーフ画像を生成
              </button>
            </>
          )}
          {message && <p className="text-xs text-zinc-500">{message}</p>}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500 text-xs">{label}</span>
      <span className={`font-semibold ${warn ? 'text-red-600' : 'text-zinc-800'}`}>{value}</span>
    </div>
  );
}
