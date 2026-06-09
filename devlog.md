# 企画業務自動化システム — devlog.md

> プロジェクト: ピーナッツクラブ 国内仕入部 企画業務自動化  
> リポジトリ: `企画システム/`

---

## 2026-05-29 — Claude拡張機能による初期実装

### 概要

Claude Code拡張機能により、仕様書 v2.1 に基づく初期コードベースが一括生成された。  
F-1〜F-5 の全モジュールのコード骨格が完成し、F-1 のコアロジックは§6.4フィクスチャによるユニットテストで検証済み。

### 実施内容

#### プロジェクト初期化
- Next.js 16 (App Router) + TypeScript プロジェクトを作成
- 依存パッケージインストール: `@supabase/supabase-js`, `@supabase/ssr`, `xlsx`, `exceljs`, `puppeteer`, `@google/generative-ai`, `googleapis`, `dotenv`
- テスト環境: `vitest` + `@vitest/coverage-v8` + `vite-tsconfig-paths`
- `.env.local` テンプレート作成（Supabase / Gemini / Google API / Railway）

#### F-1: 計算エンジン（`lib/calc/engine.ts`）
- `sizeByMaxLot()` — 共通サイジング関数（単品/アソート兼用）
  - 33,000円以内で最大ロット数を `Math.floor` で算出
  - 卸価格 = (仕入原価合計 + 3,000) × 1.25
  - ハーフ判定 = 1ロット価格 ≤ 16,500円
- `passes()` — 4条件通過判定
  - 単価 ≤ 1,000 / 最大ロット ≥ 1 / 賞味期限 ≥ 90日 / 販売期間内
- `planSingle()` / `planAssort()` — 単品/アソート企画
- `calcAlertFlags()` — 注意フラグ算出
- **テスト 32件**: §6.4 フィクスチャ全商品（①②③⑤⑧⑨⑫）+ アソート3パターン + 境界値テスト

#### パーサ群（`lib/parse/`）
- `irisu.ts` — 入数パーサ（`15×4` → `{caseQty: 15, lotsPerKou: 4}`）
  - ×/x/X/✕ 区切り対応、テスト 11件
- `minlot.ts` — 最小ロットパーサ（`1甲`/`2ケース`/`48ピース` → 実数量）
  - 単位エイリアス辞書（甲/こう/コウ, ケース/ケーズ/case等）、全角数字対応、テスト 14件
- `spec.ts` — 規格パーサ（`6個` → pieces, `125g` → grams）
  - specMatches() でアソート主判定用一致チェック、テスト 15件
- `sales-period.ts` — 販売期間パーサ + 賞味期限パーサ
  - `YYYY.MM.DD〜YYYY.MM.DD` 形式、区切り `〜/~/～/－/-` 対応、テスト 13件

#### F-2: アソートグルーピング（`lib/assort/`）
- `grouping.ts` — 4項目一致グルーピング
  - メーカー完全一致 / 規格（型＋値一致） / 入数一致 / 上代（tolerance対応）
  - `buildGroupKey()` でバケット化、テスト 15件
- `ai-assist.ts` — Gemini 補助判定
  - 品名リストから味違い/種類違いの妥当性を判定
  - `isNaturalVariant` / `confidence` / `reason` を返却

#### F-4: リーフPDF生成（`lib/leaf/`）
- `generate-pdf.ts` — Puppeteer による HTML→PDF 変換
  - Railway ワーカーへの HTTP 委譲（本番）/ ローカル Puppeteer（開発）
  - `buildHtml()` でテンプレートにデータを埋め込み
- `template.html` — リーフ HTML テンプレート（全掲載項目対応）

#### F-5: 見積書取込（`lib/import/`）
- `xlsx-cells.ts` — SheetJS によるExcelセル値抽出
  - ヘッダー文字列動的検出（エイリアス辞書）、丸数字対応
  - 全パーサを組み合わせて `RawProductRow` を生成
  - 上代 > 原価 の整合チェック
- `xlsx-images.ts` — ExcelJS/JSZip による埋め込み画像抽出
  - `xl/drawings/*.xml` のアンカーセルから商品No.対応
  - rId → mediaPath 解決
- `pdf-table.ts` — pdfplumber Python sidecar
  - `scripts/pdf_extract.py` を `child_process.execFile` で実行
- `pdf-image-llm.ts` — Gemini 構造化抽出
  - JSON Schema 固定（全12項目 + confidence）
  - 信頼度 < 0.7 で `low_extract_conf` フラグ
- `gsheet.ts` — Google Sheets API + Drive API
  - xlsx エクスポート → xlsx-cells/xlsx-images で処理

#### LLM 抽象レイヤー（`lib/llm/`）
- `types.ts` — `LlmClient` インターフェース
  - `generate()` メソッド（テキスト/画像入力、構造化出力対応）
- `gemini.ts` — Gemini 実装（`@google/generative-ai`）
  - モデル名は環境変数 `LLM_MODEL` で管理
  - responseSchema による JSON 構造化出力

#### DB スキーマ（`supabase/migrations/001_initial_schema.sql`）
- 9テーブル: `quotations`, `sheets`, `products`, `assort_groups`, `assort_items`, `leaflets`, `alert_flags`, `jobs`, `app_settings`
- インデックス、RLS ポリシー（第1段階: authenticated全操作可）
- `app_settings` に7個のデフォルト定数を挿入

#### API Routes（`app/api/`）
- `quotations/route.ts` — 案件作成（ファイルアップロード → ジョブ投入）
- `products/route.ts` — 商品一覧（判定結果付き）
- `assort/route.ts` — アソートグルーピング実行
- `assort/[groupId]/recalc/route.ts` — 比率変更時の再計算
- `leaflets/[id]/route.ts` — リーフCRUD
- `leaflets/[id]/pdf/route.ts` — リーフPDF生成
- `jobs/[id]/route.ts` — ジョブステータス確認

#### 画面コンポーネント
- `UploadForm.tsx` — ファイルアップロード + GSheet URL入力
- `AssortGroupEditor.tsx` — アソート比率編集UI
- `LeafletFinalizeForm.tsx` — リーフ正式化フォーム（商品コード・PJ番号入力）

#### Railway ワーカー（`worker/`）
- `index.ts` — ジョブポーリング + PDF レンダリングサーバ
  - `queued` → `running` → `done`/`error` のステート管理
  - `import_xlsx`, `import_pdf`, `import_image_pdf`, `import_gsheet` の4ジョブタイプ対応
- `handlers/import-xlsx.ts`, `handlers/import-pdf.ts`
- `leaf-renderer/render.ts` — HTTP エンドポイントで PDF を返却

---

### 技術的な注意点・判断

1. **v2.0 → v2.1 の重要変更を正しく反映済み**
   - 数量サイジング: 「33,000円以内最大ロット」方式に統一
   - 賞味期限: ≧90日（91日は誤り）
   - ハーフ判定: 1ロット価格 ≤ 16,500円（仕入原価合計ベースから変更）
   - 販売期間: 通過条件に追加

2. **`costTotal` が `costCap` (33,000) を超えないため、`wholesale_over` (> 45,000) は通常設定では発生しない**
   - `(33,000 + 3,000) × 1.25 = 45,000` がちょうど境界
   - テストでは `costCap` を引き上げた設定で `wholesale_over` フラグを検証

3. **Google Sheets 画像取得はエクスポート方式に決定**
   - 公式 API で over-cell 画像の直接取得が困難なため
   - xlsx にエクスポート → xlsx-images.ts で処理する方式

4. **PDF表抽出は Python sidecar (pdfplumber) を採用**
   - Node の pdf-parse はテーブル構造の保持が不十分
   - Railway コンテナに Python + pdfplumber を同梱

---

### テスト結果サマリ（2026-05-29 時点）

```
 ✓ lib/parse/irisu.test.ts          (11 tests)
 ✓ lib/parse/minlot.test.ts         (14 tests)
 ✓ lib/assort/grouping.test.ts      (15 tests)
 ✓ lib/parse/sales-period.test.ts   (13 tests)
 ✓ lib/parse/spec.test.ts           (15 tests)
 ✓ lib/calc/engine.test.ts          (32 tests)

 Test Files  6 passed (6)
      Tests  100 passed (100)
   Duration  781ms
```

---

### 残課題（次フェーズ）

- [ ] Supabase プロジェクト作成・マイグレーション適用
- [ ] Gemini API キー設定・AI系モジュールの結合テスト
- [ ] 実見積ファイル（Excel）での xlsx-cells.ts 検証
- [ ] xlsx-images.ts の実ファイル PoC
- [ ] Puppeteer 日本語フォント検証
- [ ] F-3: アソート計算 UI + API 結線
- [ ] F-6: 営業メール生成機能
- [ ] 全画面の UI/UX デザイン・実装
- [ ] Railway デプロイ（Dockerfile作成）
- [ ] Vercel デプロイ設定
