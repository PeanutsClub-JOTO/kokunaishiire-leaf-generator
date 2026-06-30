'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calcMockSingle,
  canMockAssort,
  type MockGeneratePngRequest,
  type MockProduct,
  type MockUploadResponse,
} from '@/lib/mock/workbench';

// ─── テンプレート変数充填ユーティリティ ────────────────────────────────────────

const esc = (v: string | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');

function normalizePieceSize(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  if (!s) return '—';
  const d = s
    .replace(/[ＷｗWw]\s*/g, '')
    .replace(/[ＤｄDd]\s*/g, '×')
    .replace(/[ＨｈHh]\s*/g, '×')
    .replace(/[×xX✕]\s*/g, '×')
    .replace(/×+/g, '×')
    .replace(/^×|×$/g, '')
    .replace(/\s+/g, '');
  if (!d) return '—';
  return /[a-zA-Zｍｃ㎜㎝]/.test(d) ? d : `${d}mm`;
}

const COPY_CATS: Array<[RegExp, string]> = [
  [/ポップコーン/, 'ポップコーン'], [/水羊羹|水ようかん/, '水羊羹'],
  [/羊羹|ようかん/, '羊羹'], [/カステラ/, 'カステラ'],
  [/バウム/, 'バウムクーヘン'], [/ケーキ/, 'ケーキ'],
  [/クッキー/, 'クッキー'], [/ムース/, 'ムース'],
  [/プリン/, 'プリン'], [/ゼリー/, 'ゼリー'],
  [/最中|もなか/, '最中'], [/まんじゅう|饅頭/, 'まんじゅう'],
  [/せんべい|煎餅/, 'せんべい'], [/チョコ|ショコラ/, 'チョコ'],
  [/グミ/, 'グミ'],
];
function detectCat(name: string): string {
  for (const [re, l] of COPY_CATS) if (re.test(name)) return l;
  return '商品';
}
function flavorOf(name: string): string {
  let s = (name ?? '').trim().replace(/^[0-9A-Za-zＡ-Ｚ＿\-－]+[PpＰ]?(?=[ぁ-んァ-ヶ一-龠])/, '');
  s = s.replace(/(ギフト|ｷﾞﾌﾄ|詰合せ|詰め合わせ|セット)$/g, '');
  for (const [re] of COPY_CATS) s = s.replace(new RegExp(`(?:${re.source})$`), '');
  return s.trim();
}
function buildMainCopy(name: string): string {
  const cat = detectCat(name), fl = flavorOf(name);
  if (fl && cat !== '商品') return `${fl}の${cat}が楽しめる、\n景品向けの商品です！`;
  return fl ? `${fl}！` : `${name}です！`;
}

function buildAssortMainCopy(names: string[]): string {
  if (names.length === 1) return buildMainCopy(names[0]);
  const cats = names.map(detectCat);
  const allSame = cats.every((c) => c === cats[0]) && cats[0] !== '商品';
  if (allSame) return `${names.length}種の${cats[0]}を\n一度に楽しめるアソートセット！`;
  const flavors = names.map(flavorOf).filter(Boolean);
  if (flavors.length === names.length) return `${flavors.join('＆')}\n${names.length}種アソートセット！`;
  return `${names.join('＆')}\n${names.length}種アソートセット！`;
}

function buildAssortLeafName(names: string[]): string {
  return names.join('＆');
}
function detectTheme(name: string): string {
  if (/羊羹|ようかん|和菓子|抹茶|きなこ|あんこ|最中|まんじゅう|饅頭|どら焼|団子|大福|あられ|おかき|かりんとう|せんべい|煎餅|カステラ|金澤|金沢/.test(name)) return 'theme-wagashi';
  if (/ポップコーン|スナック|ポテト|チップ|コーン|ナッツ|豆菓子|しお味|塩味/.test(name)) return 'theme-snack';
  if (/チョコ|ショコラ|キャラメル|クッキー|ビスケット|ケーキ|バウム|フィナンシェ|マドレーヌ|パイ|タルト|ドーナツ|ワッフル|ラスク|キャンディ|飴|グミ|マシュマロ/.test(name)) return 'theme-sweets';
  if (/レモン|ヨーグルト|ムース|プリン|涼|冷|ソーダ|サイダー|ラムネ|ミント|乳酸|シャーベット|アイス/.test(name)) return 'theme-cool';
  if (/マンゴー|ゼリー|果|フルーツ|桃|みかん|オレンジ|ぶどう|葡萄|巨峰|マスカット|いちご|苺|りんご|林檎|梨|メロン|パイン|キウイ|さくらんぼ|ベリー|柑橘|ピーチ/.test(name)) return 'theme-fruit';
  return 'theme-standard';
}

function productAreaClass(count: number): string {
  if (count <= 1) return 'single';
  if (count === 2) return 'assort-2';
  if (count === 3) return 'assort-3';
  return 'assort-4';
}

function buildPreviewHtml(tpl: string, product: MockProduct, overrides: Overrides, assortItems: MockProduct[] = [product]): string {
  const leafName = overrides.leafName ?? product.leafName;
  const leadTime = overrides.leadTime ?? product.leadTime;
  const themeClass = overrides.themeClass === 'auto' ? detectTheme(leafName) : overrides.themeClass;
  const mainCopy = overrides.mainCopy || buildMainCopy(leafName);
  const productCode = overrides.productCode || product.productCode || '商品コード未設定';
  const transform = `transform:translate(${overrides.imageX}px, ${overrides.imageY}px) scale(${overrides.imageScale / 100});`;
  const images = assortItems.map((item) => item.imageUrl).filter(Boolean) as string[];
  const imgHtml = images.length > 0
    ? images.slice(0, 4).map((src) => `<div class="img-slot"><img src="${src}" alt="商品画像" loading="eager" style="${transform}" /></div>`).join('')
    : '<div class="img-placeholder">商品画像未設定</div>';
  const itemCount = Math.max(assortItems.length, 1);

  return tpl
    .replaceAll('{{FONT_URL}}', '')
    .replaceAll('{{THEME_CLASS}}', themeClass)
    .replaceAll('{{AI_BG_STYLE}}', '')
    .replaceAll('{{MAIN_COPY}}', esc(mainCopy))
    .replaceAll('{{SALES_COPY}}', esc(overrides.note ?? product.note ?? ''))
    .replaceAll('{{PRODUCT_AREA_CLASS}}', productAreaClass(itemCount))
    .replaceAll('{{PRODUCT_IMAGES_HTML}}', imgHtml)
    .replaceAll('{{DRAFT_CLASS}}', overrides.showDraft ? '' : 'hidden')
    .replaceAll('{{STATUS_LABEL}}', overrides.showDraft ? '仮リーフ' : '確認済み')
    .replaceAll('{{PRODUCT_CODE}}', esc(productCode))
    .replaceAll('{{LEAF_NAME}}', esc(leafName))
    .replaceAll('{{ITEM_COUNT}}', String(itemCount))
    .replaceAll('{{LEAF_QTY}}', fmt(product.leafQty))
    .replaceAll('{{WHOLESALE_PRICE}}', fmt(product.wholesalePrice))
    .replaceAll('{{UNIT_PRICE}}', fmt(product.unitPrice))
    .replaceAll('{{PIECE_SIZE}}', esc(normalizePieceSize(product.pieceSize)))
    .replaceAll('{{SHELF_LIFE_DAYS}}', product.shelfLifeDays > 0 ? fmt(product.shelfLifeDays) : '—')
    .replaceAll('{{LEAD_TIME}}', esc(leadTime))
    .replaceAll('{{HALF_LABEL}}', '—')
    .replaceAll('{{HALF_NG_CLASS}}', 'ng')
    .replaceAll('{{PJ_NO}}', '—');
}

// ─── 型 ─────────────────────────────────────────────────────────────────────

type State = 'idle' | 'uploading' | 'done';
type WorkbenchTab = 'leaf' | 'image';
type ThemeChoice = 'auto' | 'theme-standard' | 'theme-wagashi' | 'theme-snack' | 'theme-sweets' | 'theme-cool' | 'theme-fruit';
type Overrides = {
  leafName: string;
  leadTime: string;
  note: string;
  mainCopy: string;
  productCode: string;
  themeClass: ThemeChoice;
  imageScale: number;
  imageX: number;
  imageY: number;
  showDraft: boolean;
};

function defaultOverrides(product: MockProduct): Overrides {
  return {
    leafName: product.leafName,
    leadTime: product.leadTime,
    note: product.note ?? '',
    mainCopy: buildMainCopy(product.leafName),
    productCode: product.productCode ?? '',
    themeClass: 'auto',
    imageScale: 100,
    imageX: 0,
    imageY: 0,
    showDraft: true,
  };
}

function sampleImage(label: string, bg: string, fg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
    <rect width="900" height="620" rx="46" fill="${bg}"/>
    <rect x="120" y="90" width="660" height="440" rx="42" fill="#fff" opacity=".92"/>
    <rect x="170" y="145" width="560" height="330" rx="28" fill="${fg}" opacity=".9"/>
    <text x="450" y="322" text-anchor="middle" font-size="74" font-weight="800" font-family="sans-serif" fill="#fff">${label}</text>
    <text x="450" y="410" text-anchor="middle" font-size="34" font-weight="700" font-family="sans-serif" fill="#fff">景品向けパッケージ</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function calcMock(cost: number, irisu: number, minLot: number) {
  void irisu;
  return calcMockSingle(cost, minLot);
}

function createSampleProducts(): MockProduct[] {
  const rows = [
    { id: 'sample-1', no: 1, leafName: '塩レモンムース', code: '4900000000011', cost: 400, irisu: 12, minLot: 12, image: sampleImage('塩レモン', '#dff7ff', '#28a7c7'), shelf: 90, size: 'W80×D50×H30' },
    { id: 'sample-5', no: 5, leafName: '塩レモンゼリー', code: '4900000000059', cost: 400, irisu: 12, minLot: 12, image: sampleImage('レモンゼリー', '#fff8cf', '#d6a600'), shelf: 90, size: 'W82×D52×H32' },
    { id: 'sample-2', no: 2, leafName: '金澤羊羹 抹茶', code: '4900000000028', cost: 465, irisu: 16, minLot: 32, image: sampleImage('抹茶羊羹', '#fff4e8', '#997151'), shelf: 120, size: 'W120×D32×H28' },
    { id: 'sample-3', no: 3, leafName: 'キャラメルポップコーン', code: '4900000000035', cost: 280, irisu: 24, minLot: 24, image: sampleImage('ポップコーン', '#fff3bd', '#e08a22'), shelf: 150, size: 'W95×D65×H140' },
    { id: 'sample-4', no: 4, leafName: 'プレミアムチョコギフト', code: '4900000000042', cost: 1200, irisu: 12, minLot: 12, image: sampleImage('チョコ', '#f4dfc9', '#7a3f1d'), shelf: 180, size: 'W150×D120×H42' },
  ];
  return rows.map((row) => ({
    id: row.id,
    no: row.no,
    sheetName: 'サンプル見積',
    leafName: row.leafName,
    productCode: row.code,
    cost: row.cost,
    irisu: row.irisu,
    minLot: row.minLot,
    ...calcMock(row.cost, row.irisu, row.minLot),
    shelfLifeDays: row.shelf,
    pieceSize: row.size,
    leadTime: '受注後約1週間',
    note: '',
    imageUrl: row.image,
  }));
}

// ─── スタイルユーティリティ ─────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155',
  borderRadius: 6, color: '#e2e8f0', fontSize: 13, outline: 'none',
  fontFamily: 'system-ui, sans-serif',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#64748b', marginBottom: 4, display: 'block', fontWeight: 600, letterSpacing: '0.04em',
};

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function MockPage({ templateHtml }: { templateHtml: string }) {
  const [state, setState] = useState<State>('idle');
  const [products, setProducts] = useState<MockProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [overridesMap, setOverridesMap] = useState<Record<string, Overrides>>({});
  const [assortPartnerId, setAssortPartnerId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedPngUrl, setGeneratedPngUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('leaf');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageSectionRef = useRef<HTMLDivElement>(null);

  // ブラウザがドロップ時にファイルを開くのを防ぐ（グローバル）
  useEffect(() => {
    function prevent(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('sample') !== '1') return;
    const sample = createSampleProducts();
    setProducts(sample);
    setFileName('サンプル見積書.xlsx');
    setSelectedId(sample[0]?.id ?? null);
    setOverridesMap({});
    setAssortPartnerId(null);
    setGeneratedPngUrl(null);
    setState('done');
  }, []);

  const selected = products.find((p) => p.id === selectedId) ?? products[0] ?? null;
  const assortCandidates = selected
    ? products.filter((p) => canMockAssort(selected, p))
    : [];
  const assortPartner = assortCandidates.find((p) => p.id === assortPartnerId) ?? null;
  const assortItems = selected ? [selected, ...(assortPartner ? [assortPartner] : [])] : [];
  const itemCount = Math.max(assortItems.length, 1);
  const overrides: Overrides = selected
    ? (overridesMap[selected.id] ?? defaultOverrides(selected))
    : {
        leafName: '',
        leadTime: '',
        note: '',
        mainCopy: '',
        productCode: '',
        themeClass: 'auto',
        imageScale: 100,
        imageX: 0,
        imageY: 0,
        showDraft: true,
      };

  // アソート変更時に leafName / mainCopy を自動更新（手動編集済みの場合は上書きしない）
  useEffect(() => {
    if (!selected) return;
    const cur = overridesMap[selected.id] ?? defaultOverrides(selected);
    const singleLeafName = selected.leafName;
    const singleMainCopy = buildMainCopy(selected.leafName);

    if (assortPartner) {
      const names = [selected.leafName, assortPartner.leafName];
      const autoLeaf = buildAssortLeafName(names);
      const autoCopy = buildAssortMainCopy(names);
      const updateLeaf = cur.leafName === singleLeafName;
      const updateCopy = cur.mainCopy === singleMainCopy;
      if (updateLeaf || updateCopy) {
        setOverridesMap((prev) => ({
          ...prev,
          [selected.id]: {
            ...cur,
            ...(updateLeaf ? { leafName: autoLeaf } : {}),
            ...(updateCopy ? { mainCopy: autoCopy } : {}),
          },
        }));
      }
    } else {
      // アソート解除：自動生成値なら単品デフォルトに戻す
      const wasAutoLeaf = cur.leafName.includes('＆');
      const wasAutoCopy = cur.mainCopy.includes('アソート') || cur.mainCopy.includes('＆');
      if (wasAutoLeaf || wasAutoCopy) {
        setOverridesMap((prev) => ({
          ...prev,
          [selected.id]: {
            ...cur,
            ...(wasAutoLeaf ? { leafName: singleLeafName } : {}),
            ...(wasAutoCopy ? { mainCopy: singleMainCopy } : {}),
          },
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assortPartnerId, selectedId]);

  const previewHtml = selected ? buildPreviewHtml(templateHtml, selected, overrides, assortItems) : '';

  function setOverride<K extends keyof Overrides>(key: K, value: Overrides[K]) {
    if (!selected) return;
    setOverridesMap((prev) => ({
      ...prev,
      [selected.id]: { ...(prev[selected.id] ?? defaultOverrides(selected)), [key]: value },
    }));
    setGeneratedPngUrl(null);
  }

  function loadSample() {
    window.location.href = '/mock?sample=1';
  }

  function handleSelectProduct(id: string) {
    setSelectedId(id);
    setAssortPartnerId(null);
    setGeneratedPngUrl(null);
  }

  function handleSelectAssort(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setAssortPartnerId((prev) => (prev === id ? null : id));
    setGeneratedPngUrl(null);
  }

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!imageUrl) return;
      setProducts((prev) =>
        prev.map((p) => (p.id === selected.id ? { ...p, imageUrl } : p)),
      );
      setGeneratedPngUrl(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const processFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) { setError('Excelファイル (.xlsx) を選択してください'); return; }
    setError('');
    setState('uploading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/mock/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data: MockUploadResponse = await res.json();
      setProducts(data.products);
      setFileName(data.fileName);
      setSelectedId(data.products[0]?.id ?? null);
      setOverridesMap({});
      setAssortPartnerId(null);
      setGeneratedPngUrl(null);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました');
      setState('idle');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  async function handleGeneratePng() {
    if (!selected) return;
    setGenerating(true);
    setGeneratedPngUrl(null);
    try {
      const body: MockGeneratePngRequest = { product: selected, overrides, html: previewHtml };
      const res = await fetch('/api/mock/generate-png', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setGeneratedPngUrl(url);
    } catch (e) {
      alert('PNG生成失敗: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGenerating(false);
    }
  }

  // ─── アイドル: アップロードゾーン ──────────────────────────────────────────
  if (state === 'idle' || state === 'uploading') {
    return (
      <div style={{ minHeight: 'calc(100vh - 52px)', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: '#f8fafc', letterSpacing: '0' }}>見積書ワークベンチ</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8 }}>取り込み、候補確認、リーフ編集、画像生成</div>
        </div>

        {state === 'uploading' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: '#94a3b8' }}>
            <div style={{ width: 48, height: 48, border: '4px solid #334155', borderTop: '4px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ fontSize: 14 }}>OCR処理中 / 画像抽出中...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{ width: 480, height: 260, border: `2px dashed ${isDragOver ? '#6366f1' : '#334155'}`, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'pointer', background: isDragOver ? '#1e1b4b' : '#1e293b', transition: 'all 0.15s' }}
          >
            <div style={{ fontSize: 44, color: '#94a3b8', fontWeight: 800 }}>XLSX</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>見積書をここにドロップ</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>または クリックしてファイルを選択</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>.xlsx 形式</div>
          </div>
        )}

        {state !== 'uploading' && (
          <button
            onClick={loadSample}
            style={{ width: 260, padding: '10px 0', background: '#4f46e5', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 700 }}
          >
            サンプル見積で開始
          </button>
        )}

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileChange} />
        {error && <div style={{ color: '#f87171', fontSize: 13, background: '#450a0a', padding: '8px 16px', borderRadius: 8 }}>{error}</div>}
      </div>
    );
  }

  // ─── ワークベンチ ────────────────────────────────────────────────────────────
  const IFRAME_W = 1540, IFRAME_H = 970, SCALE = 0.56;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', background: '#0f172a', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>

      {/* ─ 左パネル: 商品一覧 ─ */}
      <div style={{ width: 260, flexShrink: 0, background: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #334155' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6366f1', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{products.length}件 / 企画OK: {products.filter(p => p.isEligible).length}件</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {products.map((p) => {
            const isSelected = p.id === (selectedId ?? products[0]?.id);
            const isAssortCandidate = canMockAssort(selected, p);
            const isAssortSelected = assortPartner?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => handleSelectProduct(p.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', background: isSelected ? '#312e81' : isAssortSelected ? '#164e63' : 'transparent', borderLeft: isSelected ? '3px solid #6366f1' : isAssortSelected ? '3px solid #22d3ee' : '3px solid transparent', transition: 'background 0.1s', opacity: p.isEligible ? 1 : 0.55 }}
              >
                <div style={{ width: 38, height: 38, flexShrink: 0, background: '#0f172a', borderRadius: 5, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>IMG</span>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? '#e0e7ff' : '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {!p.isEligible && <span style={{ color: '#ef4444', marginRight: 4 }}>✕</span>}
                    {p.leafName}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                    {p.isEligible
                      ? `¥${fmt(p.wholesalePrice)} / ${fmt(p.leafQty)}個入`
                      : p.lotCost > 33000
                        ? `1ロット¥${fmt(p.lotCost)}（上限超）`
                        : `掲載単価¥${p.unitPrice.toFixed(0)}（上限超）`}
                  </div>
                  {isAssortCandidate && (
                    <button
                      onClick={(e) => handleSelectAssort(e, p.id)}
                      style={{ marginTop: 5, width: '100%', padding: '4px 0', border: '1px solid #22d3ee', borderRadius: 6, background: isAssortSelected ? '#0891b2' : '#083344', color: '#cffafe', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                    >
                      {isAssortSelected ? 'アソート選択中' : 'アソート対象'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '10px 12px', borderTop: '1px solid #334155' }}>
          <button onClick={() => { setState('idle'); setProducts([]); setFileName(''); setGeneratedPngUrl(null); }} style={{ width: '100%', padding: '7px 0', background: '#334155', border: 'none', borderRadius: 8, color: '#94a3b8', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            別のファイルを読み込む
          </button>
        </div>
      </div>

      {/* ─ 中央: プレビュー ─ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ツールバー: 価格情報 */}
        {selected && (
          <div style={{ height: 52, flexShrink: 0, background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 20 }}>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              <button
                onClick={() => { setState('idle'); setProducts([]); setFileName(''); setGeneratedPngUrl(null); }}
                style={{ background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                ← 取り込み
              </button>
              {(['リーフ生成', '画像編集'] as const).map((label, i) => {
                const tab: WorkbenchTab = i === 0 ? 'leaf' : 'image';
                const isActive = activeTab === tab;
                return (
                  <button
                    key={label}
                    onClick={() => {
                      setActiveTab(tab);
                      if (tab === 'image') setTimeout(() => imageSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                    }}
                    style={{ background: isActive ? '#312e81' : '#0f172a', border: `1px solid ${isActive ? '#6366f1' : '#334155'}`, color: isActive ? '#c7d2fe' : '#cbd5e1', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: selected.isEligible ? '#a5f3fc' : '#f87171', flexShrink: 0 }}>
              {selected.isEligible ? '企画OK' : '対象外'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 14, flexWrap: 'nowrap' }}>
              <span>1ロット <strong style={{ color: '#f1f5f9' }}>{fmt(selected.lotSize)}個</strong></span>
              <span>1ロット原価 <strong style={{ color: selected.lotCost > 33000 ? '#f87171' : '#f1f5f9' }}>¥{fmt(selected.lotCost)}</strong></span>
              <span>掲載 <strong style={{ color: '#f1f5f9' }}>{fmt(selected.leafQty)}個入</strong></span>
              <span>アイテム <strong style={{ color: '#f1f5f9' }}>{itemCount}</strong></span>
              <span>卸価格 <strong style={{ color: '#f1f5f9' }}>¥{fmt(selected.wholesalePrice)}</strong></span>
              <span>掲載単価 <strong style={{ color: selected.unitPrice > 1000 ? '#f87171' : '#86efac' }}>¥{selected.unitPrice.toFixed(0)}</strong></span>
            </div>
          </div>
        )}

        {/* プレビューiframe */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 20 }}>
          {selected ? (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, boxShadow: '0 20px 50px rgba(0,0,0,0.7)', borderRadius: 4, pointerEvents: 'none', zIndex: 1 }} />
              <div style={{ width: Math.round(IFRAME_W * SCALE), height: Math.round(IFRAME_H * SCALE), overflow: 'hidden', borderRadius: 4 }}>
                <iframe
                  key={selected.id + JSON.stringify(overrides)}
                  srcDoc={previewHtml}
                  sandbox="allow-scripts"
                  style={{ width: IFRAME_W, height: IFRAME_H, border: 'none', transformOrigin: 'top left', transform: `scale(${SCALE})`, display: 'block' }}
                />
              </div>
            </div>
          ) : (
            <div style={{ color: '#475569', fontSize: 14 }}>商品を選択してください</div>
          )}
        </div>
      </div>

      {/* ─ 右パネル: 編集 ─ */}
      {selected && (
        <div style={{ width: 280, flexShrink: 0, background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.05em' }}>リーフ編集</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 商品名 */}
            <div>
              <label style={labelStyle}>商品名（リーフ表示）</label>
              <input
                style={inputStyle}
                value={overrides.leafName}
                onChange={(e) => setOverride('leafName', e.target.value)}
                placeholder={selected.leafName}
              />
            </div>

            <div>
              <label style={labelStyle}>キャッチコピー</label>
              <textarea
                style={{ ...inputStyle, height: 78, resize: 'vertical' }}
                value={overrides.mainCopy}
                onChange={(e) => setOverride('mainCopy', e.target.value)}
              />
            </div>

            <div>
              <label style={labelStyle}>テーマ</label>
              <select
                style={inputStyle}
                value={overrides.themeClass}
                onChange={(e) => setOverride('themeClass', e.target.value as ThemeChoice)}
              >
                <option value="auto">自動</option>
                <option value="theme-standard">標準</option>
                <option value="theme-wagashi">和菓子</option>
                <option value="theme-snack">スナック</option>
                <option value="theme-sweets">スイーツ</option>
                <option value="theme-cool">涼感</option>
                <option value="theme-fruit">フルーツ</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>商品コード</label>
              <input
                style={inputStyle}
                value={overrides.productCode}
                onChange={(e) => setOverride('productCode', e.target.value)}
              />
            </div>

            {/* 発注後納期 */}
            <div>
              <label style={labelStyle}>発注後納期</label>
              <input
                style={inputStyle}
                value={overrides.leadTime}
                onChange={(e) => setOverride('leadTime', e.target.value)}
                placeholder="受注後約1週間"
              />
            </div>

            <div ref={imageSectionRef} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>商品画像</div>
              <button
                onClick={() => imageInputRef.current?.click()}
                style={{ width: '100%', padding: '7px 0', background: '#164e63', border: '1px solid #22d3ee', borderRadius: 7, color: '#cffafe', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
              >
                画像を添付 / 差し替え
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={handleImageFileChange}
              />
              <div style={{ fontSize: 10, color: '#64748b' }}>
                添付した画像はプレビューと生成画像に反映されます
              </div>
              {[
                ['拡大率', 'imageScale', 70, 140, overrides.imageScale],
                ['横位置', 'imageX', -120, 120, overrides.imageX],
                ['縦位置', 'imageY', -100, 100, overrides.imageY],
              ].map(([label, key, min, max, value]) => (
                <div key={String(key)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    <span>{label}</span>
                    <span>{String(value)}</span>
                  </div>
                  <input
                    type="range"
                    min={Number(min)}
                    max={Number(max)}
                    value={Number(value)}
                    onChange={(e) => setOverride(key as 'imageScale' | 'imageX' | 'imageY', Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={overrides.showDraft}
                onChange={(e) => setOverride('showDraft', e.target.checked)}
              />
              仮リーフ表示
            </label>

            {/* 備考 */}
            <div>
              <label style={labelStyle}>備考 / 特記事項</label>
              <textarea
                style={{ ...inputStyle, height: 72, resize: 'vertical' }}
                value={overrides.note}
                onChange={(e) => setOverride('note', e.target.value)}
                placeholder="備考を入力..."
              />
            </div>

            {/* 計算過程 */}
            {(() => {
              const maxLots = selected.isEligible ? Math.floor(33000 / selected.lotCost) : 0;
              const lotCostOver = selected.lotCost > 33000;
              const unitPriceOver = !lotCostOver && !selected.isEligible;
              const row = (label: string, value: string, highlight?: 'ok' | 'ng' | 'neutral') => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ color: '#64748b', flexShrink: 0 }}>{label}</span>
                  <span style={{ color: highlight === 'ng' ? '#f87171' : highlight === 'ok' ? '#86efac' : '#e2e8f0', fontWeight: 600, textAlign: 'right' }}>{value}</span>
                </div>
              );
              return (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, marginBottom: 4 }}>計算過程</div>
                  {row('最小ロット個数', `${fmt(selected.lotSize)} 個`)}
                  {row('× 単価', `× ¥${fmt(selected.cost)}`)}
                  {row('＝ 1ロット原価', `¥${fmt(selected.lotCost)}`, lotCostOver ? 'ng' : 'neutral')}
                  {lotCostOver && (
                    <div style={{ color: '#f87171', fontSize: 10, padding: '4px 0' }}>
                      ¥{fmt(selected.lotCost)} &gt; ¥33,000 → 企画対象外
                    </div>
                  )}
                  {!lotCostOver && (<>
                    <div style={{ borderBottom: '1px solid #1e293b', marginTop: 4, paddingTop: 4, fontSize: 10, color: '#475569' }}>
                      上限¥33,000以内 → 最大ロット数を計算
                    </div>
                    {row('floor(33,000 ÷ ' + fmt(selected.lotCost) + ')', `${maxLots} ロット`)}
                    {row('× 最小ロット', `× ${fmt(selected.lotSize)}`)}
                    {row('＝ 掲載入数', `${fmt(selected.leafQty)} 個`)}
                    <div style={{ borderBottom: '1px solid #1e293b', marginTop: 4, paddingTop: 4, fontSize: 10, color: '#475569' }}>
                      卸価格の計算
                    </div>
                    {row(`${maxLots} × ¥${fmt(selected.lotCost)}`, `¥${fmt(selected.costTotal)}`)}
                    {row('+ 諸経費', '+ ¥3,000')}
                    {row('× 掛率', '× 1.25')}
                    {row('＝ 卸価格', `¥${fmt(selected.wholesalePrice)}`)}
                    <div style={{ borderBottom: '1px solid #1e293b', marginTop: 4, paddingTop: 4, fontSize: 10, color: '#475569' }}>
                      掲載単価の計算
                    </div>
                    {row(`¥${fmt(selected.wholesalePrice)} ÷ ${fmt(selected.leafQty)}`, `¥${selected.unitPrice.toFixed(0)}`, unitPriceOver ? 'ng' : 'ok')}
                    {unitPriceOver && (
                      <div style={{ color: '#f87171', fontSize: 10, padding: '4px 0' }}>
                        ¥{selected.unitPrice.toFixed(0)} &gt; ¥1,000 → 企画対象外
                      </div>
                    )}
                    {selected.isEligible && (
                      <div style={{ color: '#86efac', fontSize: 10, padding: '4px 0', fontWeight: 700 }}>
                        ¥{selected.unitPrice.toFixed(0)} ≤ ¥1,000 ✓ 企画OK
                      </div>
                    )}
                  </>)}
                  <div style={{ marginTop: 6, borderTop: '1px solid #334155', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                    <span style={{ color: '#64748b' }}>アイテム数</span>
                    <span style={{ color: '#e2e8f0' }}>{itemCount}アイテム</span>
                  </div>
                </div>
              );
            })()}

            {/* 企画対象外 警告 */}
            {!selected.isEligible && (
              <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#fca5a5' }}>
                {selected.lotCost > 33000
                  ? `1ロット原価 ¥${fmt(selected.lotCost)} が上限(¥33,000)超過`
                  : `掲載単価 ¥${selected.unitPrice.toFixed(0)} が上限(¥1,000)超過`}
                <br />企画対象外のためリーフ掲載不可です
              </div>
            )}
          </div>

          {/* PNG生成ボタン */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleGeneratePng}
              disabled={generating}
              style={{ padding: '10px 0', background: generating ? '#334155' : '#4f46e5', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', transition: 'background 0.15s' }}
            >
              {generating ? '生成中...' : 'リーフ画像を生成'}
            </button>
            {generatedPngUrl && (
              <a
                href={generatedPngUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={`leaf-${selected.id}.png`}
                style={{ display: 'block', textAlign: 'center', padding: '8px 0', background: '#065f46', borderRadius: 8, color: '#6ee7b7', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
              >
                生成画像を開く / ダウンロード
              </a>
            )}
            <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
              編集中のプレビューを2倍解像度で出力
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
