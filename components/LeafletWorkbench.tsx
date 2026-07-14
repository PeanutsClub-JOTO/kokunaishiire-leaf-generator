'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sizeAssortV2, type SizingV2Settings } from '@/lib/calc/sizing-v2';

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
  aiBackgroundUrl: string | null;
  renderStatus: string;
  renderError: string | null;
  finalizedAt: string | null;
  finalVisibleUntil: string | null;
  driveUrl: string | null;
  driveExportStatus: string;
  driveExportError: string | null;
  assortFollowupStatus: string;
  note: string | null;
  /** ワークベンチで手動編集したキャッチコピー（AIより優先） */
  mainCopyOverride: string | null;
  /** AI生成キャッチコピー（編集欄の初期値） */
  aiMainCopy: string | null;
  /** AI生成セールスコピー（編集欄の初期値） */
  aiSubCopy: string | null;
  /** 商品コード */
  productCode: string | null;
  /** { [productId]: { scale, x, y } } 商品画像の拡大率・位置調整 */
  imageOverrides: Record<string, { scale?: number; x?: number; y?: number }> | null;
  items: WorkbenchItem[];
};

/** 商品画像1点分の調整値 */
type ImgOv = { scale: number; x: number; y: number };
const DEFAULT_IMG_OV: ImgOv = { scale: 100, x: 0, y: 0 };

function imgTransformStyle(ov: ImgOv | undefined): string {
  if (!ov || (ov.scale === 100 && ov.x === 0 && ov.y === 0)) return '';
  return `transform:translate(${ov.x}px, ${ov.y}px) scale(${ov.scale / 100});`;
}

type Props = {
  quotationId: string;
  leaflets: WorkbenchLeaflet[];
  templateHtml: string;
  settings: SizingV2Settings;
};

const DEFAULT_SETTINGS: SizingV2Settings = { profitCoef: 1.25, salesAdd: 3000, unitPriceCap: 1000, costCap: 33000, halfBase: 16500 };

type Sizing = { ok: boolean; reason?: string; setCost: number; unitPrice: number; leafQty: number; costTotal: number; wholesale: number; isHalfOk: boolean; minLotPrice: number; maxLots: number };
type JobStatus = {
  status?: string;
  error_message?: string | null;
};

function calcSizing(items: WorkbenchItem[], settings: SizingV2Settings): Sizing {
  const types = items.map((i) => ({ cost: i.cost, minLotQty: i.minLotQty, ratio: i.ratio }));
  const result = sizeAssortV2(types, settings);
  return {
    ok: result.ok,
    reason: result.reason,
    setCost: result.setCost,
    unitPrice: result.unitPrice,
    leafQty: result.leafQty,
    costTotal: result.costTotal,
    wholesale: result.wholesale,
    isHalfOk: result.isHalfOk,
    minLotPrice: result.minLotPrice,
    maxLots: result.maxLots,
  };
}

// ─── キャッチコピー生成（lib/leaf/generate-image と同ロジック簡易版） ──────────
const COPY_CATS: Array<[RegExp, string]> = [
  [/ポップコーン/, 'ポップコーン'], [/水羊羹|水ようかん/, '水羊羹'], [/羊羹|ようかん/, '羊羹'],
  [/カステラ/, 'カステラ'], [/バウム/, 'バウムクーヘン'], [/ケーキ/, 'ケーキ'], [/クッキー/, 'クッキー'],
  [/ムース/, 'ムース'], [/プリン/, 'プリン'], [/ゼリー/, 'ゼリー'], [/最中|もなか/, '最中'],
  [/まんじゅう|饅頭/, 'まんじゅう'], [/せんべい|煎餅/, 'せんべい'], [/チョコ|ショコラ/, 'チョコ'], [/グミ/, 'グミ'],
  [/から揚げ|唐揚げ/, 'から揚げ'], [/焼き鳥|やきとり/, '焼き鳥'], [/チキン/, 'チキン'],
  [/ジャーキー/, 'ジャーキー'], [/するめ|いか/, 'いか'], [/たこ焼き/, 'たこ焼き'],
  [/お好み焼き/, 'お好み焼き'], [/餃子/, '餃子'],
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
  if (/チキン|から揚げ|唐揚げ|焼き鳥|やきとり|ジャーキー|するめ|いか|たこ焼き|お好み焼き|餃子|ソーセージ|ウインナー|ハム|肉/.test(name)) return { cls: 'theme-savory', label: '惣菜' };
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
function productImagesHtml(items: WorkbenchItem[], imgOv: Record<string, ImgOv>): { areaClass: string; imagesHtml: string } {
  const withImg = items.filter((it) => it.imageUrl);
  if (withImg.length === 0) {
    return { areaClass: 'single', imagesHtml: '<div class="img-placeholder">商品画像未設定</div>' };
  }
  const tags = withImg.slice(0, 4).map((it) => {
    const style = imgTransformStyle(imgOv[it.productId]);
    const styleAttr = style ? ` style="${style}"` : '';
    return `<div class="img-slot"><img src="${esc(it.imageUrl as string)}" alt="" loading="eager"${styleAttr} /></div>`;
  }).join('');
  if (withImg.length === 1) return { areaClass: 'single', imagesHtml: tags };
  if (withImg.length === 2) return { areaClass: 'assort-2', imagesHtml: tags };
  if (withImg.length === 3) return { areaClass: 'assort-3', imagesHtml: tags };
  return { areaClass: 'assort-4', imagesHtml: tags };
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// テンプレートにデータを差し込んで HTML を生成
function buildHtml(tpl: string, leaf: WorkbenchLeaflet, items: WorkbenchItem[], sizing: Sizing, imgOv: Record<string, ImgOv> = {}, mainCopyOverride = ''): string {
  const leafName = items.map((i) => i.productName).join('・');
  const theme = selectTheme(leafName);
  const imgs = items.map((i) => i.imageUrl).filter(Boolean) as string[];
  const isAssort = items.length > 1;
  const { areaClass, imagesHtml } = productImagesHtml(items, imgOv);
  const hero = isAssort
    ? `<div class="assort-grid">${imgs.slice(0, 4).map((s) => `<img src="${esc(s)}" alt="" />`).join('')}</div>`
    : imgs[0] ? `<img class="hero-image" src="${esc(imgs[0])}" alt="" />` : '<div class="image-placeholder">商品画像未設定</div>';
  const pieceSize = items[0]?.pieceSize ?? null;
  const aiBgStyle = leaf.aiBackgroundUrl
    ? `background-image:url('${esc(leaf.aiBackgroundUrl)}');background-size:cover;background-position:center;opacity:0.92;`
    : '';
  return tpl
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{AI_BG_STYLE}}', aiBgStyle)
    .replaceAll('{{THEME_CLASS}}', theme.cls)
    .replaceAll('{{THEME_LABEL}}', esc(theme.label))
    .replaceAll('{{MAIN_COPY}}', esc(mainCopyOverride.trim() || mainCopy(items)))
    .replaceAll('{{SALES_COPY}}', esc(leaf.note?.trim() ? leaf.note : salesCopy(items)))
    .replaceAll('{{ASSORT_CLASS}}', isAssort ? 'assort' : '')
    .replaceAll('{{HERO_IMAGE_HTML}}', hero)
    .replaceAll('{{SUB_IMAGE_HTML}}', imgs[0] ? `<img src="${esc(imgs[0])}" alt="" />` : '')
    .replaceAll('{{PRODUCT_AREA_CLASS}}', areaClass)
    .replaceAll('{{PRODUCT_IMAGES_HTML}}', imagesHtml)
    .replaceAll('{{DRAFT_CLASS}}', '')
    .replaceAll('{{STATUS_LABEL}}', '')
    .replaceAll('{{STATUS_NOTE}}', '')
    .replaceAll('{{PRODUCT_CODE}}', esc(leaf.productCode?.trim() || '商品コード未設定'))
    .replaceAll('{{LEAF_NAME}}', esc(leaf.leafName || leafName))
    .replaceAll('{{ITEM_COUNT}}', fmt(items.length))
    .replaceAll('{{LEAF_QTY}}', fmt(sizing.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', fmt(sizing.wholesale))
    .replaceAll('{{UNIT_PRICE}}', fmt(sizing.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', esc(sizeMm(pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', leaf.shelfLifeDays != null ? fmt(leaf.shelfLifeDays) : '—')
    .replaceAll('{{LEAD_TIME}}', esc(leaf.leadTime || '受注後約1週間'))
    .replaceAll('{{HALF_LABEL}}', sizing.isHalfOk ? '可' : '不可')
    .replaceAll('{{HALF_NG_CLASS}}', sizing.isHalfOk ? '' : 'ng')
    .replaceAll('{{PJ_NO}}', '');
}

// ─── コンポーネント ────────────────────────────────────────────────────────────
export default function LeafletWorkbench({ quotationId, leaflets, templateHtml, settings }: Props) {
  void quotationId;
  const sizingSettings = settings ?? DEFAULT_SETTINGS;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(leaflets[0]?.id ?? '');
  // キャッチ/セールスコピーは AI生成文を初期値として編集欄に出す（自由に修正→保存できる）
  const [edits, setEdits] = useState<Record<string, { leafName: string; leadTime: string; note: string; mainCopy: string; productCode: string }>>(() =>
    Object.fromEntries(leaflets.map((l) => [l.id, {
      leafName: l.leafName,
      leadTime: l.leadTime,
      note: l.note ?? l.aiSubCopy ?? '',
      mainCopy: l.mainCopyOverride ?? l.aiMainCopy ?? '',
      productCode: l.productCode ?? '',
    }])),
  );
  // アソート選択: ベースリーフID → { productId: ratio }（ベース商品を必ず含む）
  const [assortSel, setAssortSel] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(leaflets.map((l) => [l.id, Object.fromEntries(l.items.map((it) => [it.productId, it.ratio]))])),
  );
  // 画像調整: リーフID → { productId: { scale, x, y } }
  const [imgOvMap, setImgOvMap] = useState<Record<string, Record<string, ImgOv>>>(() =>
    Object.fromEntries(
      leaflets.map((l) => [
        l.id,
        Object.fromEntries(
          l.items.map((it) => {
            const ov = l.imageOverrides?.[it.productId];
            return [it.productId, { scale: ov?.scale ?? 100, x: ov?.x ?? 0, y: ov?.y ?? 0 }];
          }),
        ),
      ]),
    ),
  );
  // アソート時にどの商品の画像を調整するか
  const [imgEditPid, setImgEditPid] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const hasPendingAutoImages = leaflets.some(
    (l) =>
      (!l.leafImageUrl || l.renderStatus === 'pending' || l.renderStatus === 'rendering') &&
      l.renderStatus !== 'error',
  );
  const hasPendingDriveExport = leaflets.some((l) => l.driveExportStatus === 'pending' || l.driveExportStatus === 'exporting');

  useEffect(() => {
    if (!hasPendingAutoImages && !hasPendingDriveExport) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [hasPendingAutoImages, hasPendingDriveExport, router]);

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
  const isTemporaryAssort = isAssort && selected.items.length === 1;
  const sizing = useMemo(() => calcSizing(editedItems, sizingSettings), [editedItems, sizingSettings]);
  const leafForPreview = useMemo<WorkbenchLeaflet>(
    () => ({ ...selected, leafName: edit.leafName, leadTime: edit.leadTime, note: edit.note, productCode: edit.productCode, isSingle: !isAssort }),
    [selected, edit, isAssort],
  );
  const imgOv = useMemo<Record<string, ImgOv>>(() => imgOvMap[selected.id] ?? {}, [imgOvMap, selected.id]);
  const previewHtml = useMemo(
    () => buildHtml(templateHtml, leafForPreview, editedItems, sizing, imgOv, edit.mainCopy),
    [templateHtml, leafForPreview, editedItems, sizing, imgOv, edit.mainCopy],
  );

  // 画像調整の対象商品（アソート時はタブで選択、単品は先頭）
  const imgEditTargets = editedItems.filter((it) => it.imageUrl);
  const imgEditItem = imgEditTargets.find((it) => it.productId === imgEditPid) ?? imgEditTargets[0] ?? null;
  const imgEditOv: ImgOv = (imgEditItem && imgOv[imgEditItem.productId]) || DEFAULT_IMG_OV;

  // 保存対象の image_overrides（既定値の商品は省く）
  function buildOverridesPayload(): Record<string, ImgOv> {
    const out: Record<string, ImgOv> = {};
    for (const it of editedItems) {
      const ov = imgOv[it.productId];
      if (ov && !(ov.scale === 100 && ov.x === 0 && ov.y === 0)) out[it.productId] = ov;
    }
    return out;
  }

  function patchEdit(patch: Partial<{ leafName: string; leadTime: string; note: string; mainCopy: string; productCode: string }>) {
    setEdits((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], ...patch } }));
  }
  function setImgOv(productId: string, patch: Partial<ImgOv>) {
    setImgOvMap((prev) => {
      const cur = prev[selected.id] ?? {};
      const base = cur[productId] ?? DEFAULT_IMG_OV;
      return { ...prev, [selected.id]: { ...cur, [productId]: { ...base, ...patch } } };
    });
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

  async function waitForJob(jobId: string, label: string, maxAttempts = 90): Promise<boolean> {
    let failureCount = 0;
    for (let i = 0; i < maxAttempts; i += 1) {
      await wait(2000);
      const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.job) {
        failureCount += 1;
        if (failureCount >= 3) {
          throw new Error(data.error ?? `${label}の状態確認に失敗しました`);
        }
        setMessage(`${label}中です。状態を再確認しています…`);
        continue;
      }
      failureCount = 0;
      const job = data.job as JobStatus;
      if (job.status === 'error') {
        throw new Error(job.error_message ?? `${label}に失敗しました`);
      }
      if (job.status === 'done') return true;
      if (i % 5 === 4) router.refresh();
    }
    return false;
  }

  // 単品リーフの情報を保存 → リーフ画像を再生成
  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const patchRes = await fetch(`/api/leaflets/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaf_name: edit.leafName,
          lead_time: edit.leadTime,
          note: edit.note,
          product_code: edit.productCode.trim() || null,
          main_copy_override: edit.mainCopy.trim() || null,
          image_overrides: buildOverridesPayload(),
        }),
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) {
        setMessage(patchData.error ?? '保存に失敗しました');
        return;
      }

      // 調整内容を最終PNGへ反映するため再レンダリングを依頼
      const imageRes = await fetch(`/api/leaflets/${selected.id}/image`, { method: 'POST' });
      const imageData = await imageRes.json().catch(() => ({}));
      if (!imageRes.ok) {
        setMessage(imageData.error ?? 'リーフ画像生成ジョブの登録に失敗しました');
        return;
      }
      setMessage('保存しました。リーフ画像を再生成しています…');
      if (imageData.job_id) {
        const completed = await waitForJob(imageData.job_id, 'リーフ画像を再生成');
        if (completed) {
          setMessage('リーフ画像を更新しました。');
        } else {
          setMessage('リーフ画像の再生成を受け付けました。まだ処理中なので、少し後に画面を更新してください。');
        }
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存に失敗しました');
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
      // 作成された新リーフに画像/キャッチコピー調整を引き継いでから画像生成を依頼
      if (data.leaflet?.id) {
        const overrides = buildOverridesPayload();
        const mainCopy = edit.mainCopy.trim();
        const patchBody: Record<string, unknown> = {};
        if (Object.keys(overrides).length > 0) patchBody.image_overrides = overrides;
        if (mainCopy) patchBody.main_copy_override = mainCopy;
        if (Object.keys(patchBody).length > 0) {
          await fetch(`/api/leaflets/${data.leaflet.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          });
        }
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

  async function handleFinalize() {
    setSaving(true);
    setMessage('');
    try {
      let followup: 'not_needed' | 'accepted' | 'declined' = 'not_needed';
      if (selected.status !== 'final' && !isAssort && compatItems.length > 0) {
        followup = window.confirm(
          'この商品は他の商品とアソートできる可能性があります。\n\nOK: 確定後もアソート企画を検討する\nキャンセル: 今回は単品確定のみ',
        ) ? 'accepted' : 'declined';
      }

      setMessage(selected.status === 'final' ? 'Drive転送中…' : '確定してDriveへ転送中…');

      const res = await fetch(`/api/leaflets/${selected.id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaf_name: edit.leafName,
          lead_time: edit.leadTime,
          note: edit.note,
          product_code: edit.productCode.trim() || null,
          main_copy_override: edit.mainCopy.trim() || null,
          assort_followup_status: followup,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? (selected.status === 'final' ? 'Drive再送に失敗しました' : '確定に失敗しました'));
        return;
      }

      if (data.drive_error) {
        setMessage(`Drive転送エラー: ${data.drive_error}`);
      } else if (data.drive_done) {
        setMessage(
          followup === 'accepted'
            ? 'Driveへ転送しました。必要に応じて右の候補からアソートも作成できます。'
            : 'Driveへ転送しました。',
        );
      } else {
        setMessage('確定しました。');
      }
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : (selected.status === 'final' ? 'Drive再送に失敗しました' : '確定に失敗しました'));
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
              {l.renderError && (
                <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  AI背景は通常背景で代替
                </div>
              )}
              {l.status === 'final' && (
                <div className="mt-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  確定済み
                </div>
              )}
            </button>
          );
        })}
      </aside>

      {/* 中央: ライブプレビュー */}
      <main className="flex-1 overflow-auto bg-zinc-100 p-6">
        <div className="mx-auto" style={{ width: 770 }}>
          {hasPendingAutoImages && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              見積取込後のリーフ画像を自動生成中です。完了するとこの画面に順次反映されます。
            </div>
          )}
          <div className="overflow-hidden rounded-lg shadow-lg" style={{ width: 770, height: 485 }}>
            <iframe
              title="leaf-preview"
              srcDoc={previewHtml}
              style={{ width: 1540, height: 970, border: 0, transform: 'scale(0.5)', transformOrigin: 'top left' }}
            />
          </div>
          {selected.aiBackgroundUrl && (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              AI生成背景を使った編集プレビューを表示中です。「情報を保存」で生成画像を更新します。
            </div>
          )}
          {!sizing.ok && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              この構成は企画対象外です（{sizing.reason === 'unit_over' ? '卸価格÷入数が1,000円超' : sizing.reason === 'cost_over' ? '1ロットが33,000円超' : sizing.reason}）。比率を調整してください。
            </div>
          )}
          {selected.renderError && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {selected.renderError}
            </div>
          )}
        </div>
      </main>

      {/* 右: 編集パネル */}
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">商品コード</label>
          <input
            value={edit.productCode}
            onChange={(e) => patchEdit({ productCode: e.target.value })}
            placeholder="例: AB-1234（末尾$=直送）"
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
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
          <label className="block text-xs font-medium text-zinc-500 mb-1">キャッチコピー（空欄ならAI/自動生成）</label>
          <textarea
            value={edit.mainCopy}
            onChange={(e) => patchEdit({ mainCopy: e.target.value })}
            rows={2}
            placeholder={mainCopy(editedItems)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <p className="mt-0.5 text-[10px] text-zinc-400">AIが生成した文章が初期表示されます。自由に修正OK。空欄で保存すると次回の再生成でAIが作り直します。</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">セールスコピー（空欄ならAI/自動生成）</label>
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
                const wouldExceed = !checked && it.cost * sizingSettings.profitCoef >= sizingSettings.unitPriceCap;
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
            <p className="mt-2 text-[10px] text-amber-600">掲載単価が1,000円以内に収まる構成だけ作成できます</p>
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
                    <span className="shrink-0">
                      <span className="text-zinc-400 mr-2">単価{fmt(it.cost)}円</span>
                      <span className="font-medium">×{it.ratio}</span>
                    </span>
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

        {/* 商品画像の調整（拡大率・位置） */}
        {imgEditItem && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-600">商品画像の調整</label>
              <button
                onClick={() => imgEditItem && setImgOv(imgEditItem.productId, DEFAULT_IMG_OV)}
                className="text-[10px] text-zinc-400 hover:text-zinc-600 underline"
              >
                リセット
              </button>
            </div>
            {imgEditTargets.length > 1 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {imgEditTargets.map((it, i) => {
                  const active = it.productId === imgEditItem.productId;
                  return (
                    <button
                      key={it.productId}
                      onClick={() => setImgEditPid(it.productId)}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium truncate max-w-[9rem] border ${active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'}`}
                    >
                      {i + 1}. {it.productName}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="space-y-2">
              {([
                ['拡大率', 'scale', 70, 200, imgEditOv.scale, '%'],
                ['横位置', 'x', -200, 200, imgEditOv.x, 'px'],
                ['縦位置', 'y', -150, 150, imgEditOv.y, 'px'],
              ] as const).map(([label, key, min, max, value, unit]) => (
                <div key={key} className="text-xs">
                  <div className="flex justify-between text-zinc-600 mb-0.5">
                    <span>{label}</span>
                    <span className="font-medium">{value}{unit}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => imgEditItem && setImgOv(imgEditItem.productId, { [key]: Number(e.target.value) } as Partial<ImgOv>)}
                    className="w-full"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-zinc-400">「情報を保存」で調整内容を反映した画像を再生成します。</p>
          </div>
        )}

        {/* 計算結果（ライブ） */}
        <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm space-y-1">
          <Row
            label={isAssort ? '仕入原価（構成1組）' : '仕入単価（元単価）'}
            value={`${fmt(sizing.setCost)}円`}
          />
          <Row label="単価" value={`${fmt(sizing.unitPrice)}円`} warn={sizing.unitPrice > sizingSettings.unitPriceCap} />
          <Row label="入数" value={`${fmt(sizing.leafQty)}個`} />
          <Row label="卸価格" value={`${fmt(sizing.wholesale)}円`} />
          <Row label="ハーフ" value={sizing.isHalfOk ? '可' : '不可'} />
          <Row
            label="Drive"
            value={
              selected.driveExportStatus === 'done'
                ? '転送済み'
                : selected.driveExportStatus === 'error'
                  ? 'エラー'
                  : selected.driveExportStatus === 'pending' || selected.driveExportStatus === 'exporting'
                    ? '転送中'
                    : '未確定'
            }
            warn={selected.driveExportStatus === 'error'}
          />
          <button
            onClick={() => setShowCalc((v) => !v)}
            className="w-full pt-1 text-left text-[11px] font-medium text-indigo-500 hover:text-indigo-700"
          >
            {showCalc ? '▼ 計算過程を閉じる' : '▶ 計算過程を見る'}
          </button>
          {showCalc && (
            <div className="rounded border border-zinc-200 bg-white p-2 text-[11px] space-y-1">
              <CalcRow label="1ロット原価" value={`¥${fmt(sizing.minLotPrice)}`} warn={sizing.minLotPrice > sizingSettings.costCap} />
              <CalcRow label={`上限¥${fmt(sizingSettings.costCap)}以内の最大ロット数`} value="" />
              <CalcRow label={`floor(${fmt(sizingSettings.costCap)} ÷ ${fmt(sizing.minLotPrice)})`} value={`${fmt(sizing.maxLots)} ロット`} indent />
              <CalcRow label="掲載入数" value="" />
              <CalcRow label={`1ロット入数 × ${fmt(sizing.maxLots)}`} value={`${fmt(sizing.leafQty)} 個`} indent />
              <CalcRow label="仕入原価合計" value="" />
              <CalcRow label={`¥${fmt(sizing.minLotPrice)} × ${fmt(sizing.maxLots)}`} value={`¥${fmt(sizing.costTotal)}`} indent />
              <CalcRow label="掲載卸売価格" value="" />
              <CalcRow label={`(¥${fmt(sizing.costTotal)} + ¥${fmt(sizingSettings.salesAdd)}) × ${sizingSettings.profitCoef}`} value={`¥${fmt(sizing.wholesale)}`} indent />
              <CalcRow label="掲載単価" value="" />
              <CalcRow
                label={`¥${fmt(sizing.wholesale)} ÷ ${fmt(sizing.leafQty)}個`}
                value={`¥${sizing.unitPrice.toFixed(0)}（上限¥${fmt(sizingSettings.unitPriceCap)}）`}
                indent
                warn={sizing.unitPrice > sizingSettings.unitPriceCap}
              />
              <CalcRow
                label={`ハーフ判定: 1ロット原価 ≦ ¥${fmt(sizingSettings.halfBase)}`}
                value={sizing.isHalfOk ? '可' : '不可'}
                warn={!sizing.isHalfOk}
              />
            </div>
          )}
        </div>
        {selected.driveExportError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            Drive転送エラー: {selected.driveExportError}
          </p>
        )}
        {selected.driveUrl && (
          <a
            href={selected.driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Google Driveの確定リーフを開く →
          </a>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {isTemporaryAssort ? (
            // 単品から一時的にアソート選択中: 作成＋画像生成を一括
            <button onClick={handleCreateAssort} disabled={saving || !sizing.ok}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '処理中…' : 'この組み合わせでアソート作成＋画像生成'}
            </button>
          ) : (
            // 単品/作成済みアソート: 情報保存。画像生成は自動または作成時に実行
            <>
              <button onClick={handleSave} disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? '処理中…' : '情報を保存'}
              </button>
              <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                保存すると、編集内容と画像調整を反映してリーフ画像が自動再生成されます。
              </p>
            </>
          )}
          {selected.status === 'final' ? (
            <>
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                確定済み。確定リーフ一覧に3日間表示されます。
              </div>
              {selected.driveExportStatus !== 'done' && (
                <button onClick={handleFinalize} disabled={saving || !selected.leafImageUrl}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? '転送中…' : 'Driveへ再送する'}
                </button>
              )}
            </>
          ) : isTemporaryAssort ? (
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              先に「この組み合わせでアソート作成＋画像生成」を押すと、作成されたアソートリーフを確定できます。
            </p>
          ) : (
            <button onClick={handleFinalize} disabled={saving || !selected.leafImageUrl || !sizing.ok}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              企画確定してDriveへ送る
            </button>
          )}
          {!selected.leafImageUrl && (
            <p className="text-[10px] text-zinc-400">リーフ画像が生成されると確定できます。</p>
          )}
          {!isAssort && selected.status !== 'final' && compatItems.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] text-amber-700">
              確定時に、この商品を他の商品でアソートするか確認します。
            </p>
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

function CalcRow({ label, value, indent, warn }: { label: string; value: string; indent?: boolean; warn?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${indent ? 'pl-3' : ''}`}>
      <span className={indent ? 'text-zinc-500' : 'font-semibold text-zinc-600'}>{label}</span>
      <span className={`shrink-0 font-semibold ${warn ? 'text-red-600' : 'text-zinc-800'}`}>{value}</span>
    </div>
  );
}
