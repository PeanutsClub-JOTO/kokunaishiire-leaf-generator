# 企画業務自動化システム — STATUS.md

> 最終更新: 2026-05-29  
> 正規仕様書: `仕様書_v2.1.md`  
> 技術スタック: Next.js 16 (App Router) + TypeScript + Supabase + Gemini + Puppeteer

---

## 1. 開発フェーズ進捗

| フェーズ | 機能 | ステータス | 備考 |
|---------|------|-----------|------|
| **F-1** | 計算エンジン（判定ロジック） | ✅ 完了 | 純粋関数実装済み、テスト32件パス |
| **F-1** | パーサ群（入数/最小ロット/規格/販売期間/賞味期限） | ✅ 完了 | テスト53件パス（4パーサ合計） |
| **F-1** | Excelセル値抽出（F-5前倒し分） | ✅ コード実装済み | `xlsx-cells.ts` 完成。ヘッダー文字列動的特定。**実ファイルでの検証未実施** |
| **F-2** | アソートグルーピング | ✅ コード実装済み | `grouping.ts` + テスト15件パス |
| **F-2** | AI補助判定（味違い判定） | ✅ コード実装済み | `ai-assist.ts` 完成。**Gemini API接続未検証** |
| **F-3** | アソート計算（比率変更→再計算） | ⚠️ 部分実装 | エンジン側 `planAssort` は完成。**UI（比率スライダー）+ API Route結線は未完了** |
| **F-4** | リーフPDF生成 | ⚠️ 部分実装 | `generate-pdf.ts` + `template.html` 実装済み。**Puppeteer日本語フォント検証・テンプレートデザイン未完了** |
| **F-5** | Excel画像抽出 | ✅ コード実装済み | `xlsx-images.ts` ExcelJS使用。**実ファイルでのPoC未実施** |
| **F-5** | PDF表抽出 | ✅ コード実装済み | `pdf-table.ts` + `scripts/pdf_extract.py`。**pdfplumber動作検証未実施** |
| **F-5** | 画像PDF/AI構造化抽出 | ✅ コード実装済み | `pdf-image-llm.ts` JSON Schema固定。**Gemini API接続未検証** |
| **F-5** | Google Sheets取込 | ✅ コード実装済み | `gsheet.ts` xlsxエクスポート方式。**サービスアカウント未設定** |
| **F-6** | 営業メール生成 | ❌ 未着手 | — |

---

## 2. テスト状況

```
Test Files  6 passed (6)
     Tests  100 passed (100)
  Duration  781ms
```

| テストファイル | テスト数 | ステータス |
|--------------|---------|-----------|
| `lib/calc/engine.test.ts` | 32 | ✅ 全パス |
| `lib/parse/irisu.test.ts` | 11 | ✅ 全パス |
| `lib/parse/minlot.test.ts` | 14 | ✅ 全パス |
| `lib/parse/spec.test.ts` | 15 | ✅ 全パス |
| `lib/parse/sales-period.test.ts` | 13 | ✅ 全パス |
| `lib/assort/grouping.test.ts` | 15 | ✅ 全パス |

### テスト未作成のモジュール

| モジュール | 理由 |
|-----------|------|
| `lib/import/xlsx-cells.ts` | 実ファイル必要（統合テスト） |
| `lib/import/xlsx-images.ts` | 実ファイル必要（統合テスト） |
| `lib/import/pdf-table.ts` | Python sidecar依存 |
| `lib/import/pdf-image-llm.ts` | Gemini API依存 |
| `lib/import/gsheet.ts` | Google API認証依存 |
| `lib/assort/ai-assist.ts` | Gemini API依存 |
| `lib/leaf/generate-pdf.ts` | Puppeteer依存 |

---

## 3. インフラ・環境ステータス

| 項目 | ステータス | 備考 |
|------|-----------|------|
| Supabase プロジェクト | ❌ 未作成 | `.env.local` はプレースホルダ状態 |
| DB マイグレーション | ✅ SQL完成 | `supabase/migrations/001_initial_schema.sql` 適用待ち |
| Gemini API キー | ❌ 未設定 | `.env.local` に `GEMINI_API_KEY=your-gemini-api-key` |
| Google サービスアカウント | ❌ 未設定 | GSheet取込に必要 |
| Railway ワーカー | ❌ 未デプロイ | コードは `worker/` に完成 |
| Vercel デプロイ | ❌ 未実施 | — |
| pdfplumber (Python) | ❓ 未確認 | ローカルにPython環境あり（`.venv`）。pdfplumberの有無未確認 |

---

## 4. ファイル構成（ソースコード）

```
企画システム/
├── app/
│   ├── api/
│   │   ├── assort/
│   │   │   ├── route.ts                    # アソートAPI
│   │   │   └── [groupId]/recalc/route.ts   # アソート再計算API
│   │   ├── jobs/[id]/route.ts              # ジョブステータスAPI
│   │   ├── leaflets/[id]/
│   │   │   ├── pdf/route.ts                # リーフPDF生成API
│   │   │   └── route.ts                    # リーフCRUD API
│   │   ├── products/route.ts               # 商品一覧API
│   │   └── quotations/route.ts             # 案件取込API
│   ├── quotations/
│   │   └── [id]/
│   │       ├── assort/page.tsx             # アソート構成画面
│   │       ├── leaflets/[groupId]/page.tsx  # リーフプレビュー画面
│   │       └── products/page.tsx           # 商品一覧・判定結果画面
│   ├── page.tsx                            # トップ（見積取込）
│   ├── layout.tsx                          # レイアウト
│   └── globals.css                         # グローバルCSS
├── components/
│   ├── AssortGroupEditor.tsx               # アソート比率編集UI
│   ├── LeafletFinalizeForm.tsx             # リーフ正式化フォーム
│   └── UploadForm.tsx                      # ファイルアップロード
├── lib/
│   ├── calc/
│   │   ├── engine.ts                       # 計算エンジン（純粋関数）
│   │   └── engine.test.ts                  # テスト 32件
│   ├── parse/
│   │   ├── irisu.ts + test                 # 入数パーサ（11件）
│   │   ├── minlot.ts + test               # 最小ロットパーサ（14件）
│   │   ├── spec.ts + test                  # 規格パーサ（15件）
│   │   └── sales-period.ts + test          # 販売期間・賞味期限パーサ（13件）
│   ├── assort/
│   │   ├── grouping.ts + test             # アソートグルーピング（15件）
│   │   └── ai-assist.ts                    # AI補助判定（Gemini）
│   ├── import/
│   │   ├── xlsx-cells.ts                   # Excelセル値抽出（SheetJS）
│   │   ├── xlsx-images.ts                  # Excel画像抽出（ExcelJS/JSZip）
│   │   ├── pdf-table.ts                    # PDF表抽出（pdfplumber sidecar）
│   │   ├── pdf-image-llm.ts               # 画像PDF AI抽出（Gemini）
│   │   └── gsheet.ts                       # Google Sheets取込
│   ├── leaf/
│   │   ├── generate-pdf.ts                 # リーフPDF生成（Puppeteer）
│   │   └── template.html                   # リーフHTMLテンプレート
│   ├── llm/
│   │   ├── types.ts                        # LlmClient抽象インターフェース
│   │   └── gemini.ts                       # Gemini実装
│   └── supabase/
│       ├── client.ts                       # クライアント
│       └── types.ts                        # DB型定義
├── worker/
│   ├── index.ts                            # Railway常駐ワーカー（ジョブポーリング）
│   ├── handlers/
│   │   ├── import-xlsx.ts                  # xlsxインポートハンドラ
│   │   └── import-pdf.ts                   # PDFインポートハンドラ
│   ├── leaf-renderer/
│   │   └── render.ts                       # PDF レンダリングサーバ
│   └── tsconfig.json
├── scripts/
│   └── pdf_extract.py                      # pdfplumber Python sidecar
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql          # 初期スキーマ（9テーブル + RLS）
├── tests/
│   └── fixtures/                           # テストフィクスチャ（空）
├── package.json                            # Next.js 16 + 各種依存
├── vitest.config.ts                        # テスト設定
├── .env.local                              # 環境変数（プレースホルダ）
└── tsconfig.json
```

---

## 5. 主要な決定事項

| 項目 | 決定内容 | 根拠 |
|------|---------|------|
| 数量サイジング方式 | フローチャート方式（33,000円以内で最大ロット数） | v2.1 §0で確定。v2.0の最小ロット方式は廃止 |
| 賞味期限基準 | ≧90日で通過 | v2.1 §0.2（v2.0の91日は誤り） |
| ハーフ判定 | 1ロット価格 ≤ 16,500円 | v2.1 §0.4（v2.0の仕入原価合計ベースから変更） |
| 販売期間 | 通過条件に追加（期間外=除外） | v2.1 §0.3 |
| 規格 | pieces/grams 両方対応 | v2.1 §0.5 |
| LLMプロバイダ | Gemini (Google) | ユーザー選択 |
| デプロイ先 | Vercel + Railway | ユーザー選択 |
| DB | Supabase（新規作成） | ユーザー選択 |
| 定数管理 | DB `app_settings` テーブル | ハードコード禁止（§4） |

---

## 6. 未解決・次アクション

### ブロッカー（開発を進める前に必要）
1. **Supabase プロジェクト作成** → URL・Key取得 → `.env.local` 更新 → マイグレーション適用
2. **Gemini API キー取得** → `.env.local` に設定
3. **実見積ファイル（Excel）入手** → `xlsx-cells.ts` の実ファイル検証

### PoC必須（§11）
1. Google Sheets 埋め込み画像取得方式の検証
2. Excel 画像 ↔ No. 対応の実ファイル検証
3. Puppeteer 日本語フォント埋め込み検証
4. pdfplumber vs pdf-parse の精度比較
5. Gemini 構造化抽出の精度測定

### 残タスク
- F-3: アソート計算 UI（比率スライダー）+ API結線
- F-4: リーフテンプレートのデザイン最終化
- F-6: 営業メール生成機能
- 全画面のUI/UXデザイン・実装
- Railway ワーカーのDockerfile作成・デプロイ
- Vercel デプロイ設定
- 統合テスト・E2Eテスト
