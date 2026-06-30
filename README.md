# 企画業務自動化システム

国内仕入部のOEM商品企画を支援する社内ツールです。

メーカー見積書の商品情報をもとに、ゲームセンター向けの金額条件判定、アソート候補作成、掲載数量・卸価格・単価計算、リーフ画像生成までを自動化することを目的にしています。

## 現在できること

- 見積商品データの取り込み土台
- 原価、最小ロット、賞味期限、販売期間の判定
- 同一メーカー内の商品をアソート候補としてグルーピング
- アソート比率変更時の再計算
- リーフ掲載情報の作成
- リーフ画像の自動生成
- リーフ画像テーマの自動切替
- 商品コード、PJ番号の人手入力
- PDF生成の既存導線
- 重い画像生成処理のワーカー化

## リーフ画像

最終的に営業・国内仕入部が確認する横長の販促画像です。

掲載する主な情報は以下です。

- 商品画像
- 商品名
- アイテム数
- 入数
- 卸価格
- 単価
- 商品サイズ
- 賞味期限
- 受注後納期
- ハーフ可否
- PJ番号
- 商品コード

商品コードは管理情報なので、リーフ上では一番目立たない薄い小さな表示にしています。

### テーマ

商品名や備考から、リーフ画像の見た目を自動で切り替えます。

- フルーツ、ゼリー系
- 和菓子系
- スナック、ポップコーン系
- チョコ、焼菓子系
- 涼感、ヨーグルト、レモン系
- 標準

テーマ判定の実装は `lib/leaf/generate-image.ts`、見た目のテンプレートは `lib/leaf/image-template.html` です。

### プレビュー確認

テーマ別の見た目確認用HTMLを生成できます。

```bash
node scripts/generate-leaf-preview.mjs
```

生成されるファイル:

```text
leaf_theme_preview.html
leaf-theme-previews/
```

ブラウザで `leaf_theme_preview.html` を開くと、テーマごとのリーフ画像プレビューを確認できます。

注意: プレビュー用の商品画像はテストデータです。本番では見積書に紐づく商品画像を使用します。

## ワーカーとは

ワーカーは、重い処理を画面操作とは別に裏側で実行する処理係です。

リーフ画像生成ではChrome/Puppeteerを使うため、APIリクエスト内で直接実行するとタイムアウトしやすくなります。そのため、画面側ではジョブを登録し、ワーカーが裏でPNG画像を生成してStorageに保存します。

流れ:

```text
画面で「リーフ画像生成」
  ↓
APIが jobs に render_leaflet_image を登録
  ↓
ワーカーがジョブを処理
  ↓
PNG画像を生成
  ↓
Storageに保存
  ↓
leaflets.leaf_image_url を更新
```

関連ファイル:

- `app/api/leaflets/[id]/image/route.ts`
- `worker/handlers/render-leaflet-image.ts`
- `worker/leaf-renderer/render.ts`

## 開発コマンド

```bash
npm run dev
npm test
npm run build
```

このプロジェクトでは Next.js 16 を使用しています。`npm run build` は環境差でTurbopackが落ちやすかったため、`next build --webpack` にしています。

## デプロイ前チェック

```bash
npm ci
npm test
npm run build
```

Vercel へデプロイする場合は `vercel.json` の設定で Next.js としてビルドされます。リーフ画像の本番生成は API 内で直接Puppeteerを動かさず、ジョブ登録後にワーカーで処理する構成です。

モック画面:

```text
/mock
/mock?sample=1
```

## 環境変数

主な環境変数:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_BASE_URL=
RENDERER_PORT=3001
NOTO_FONT_URL=
PUPPETEER_LAUNCH_TIMEOUT_MS=60000
```

`WORKER_BASE_URL` がある場合、リーフ画像生成はワーカーに委譲されます。未設定の場合はローカルで直接生成します。

## DB

Supabaseを使用します。

Migration:

```text
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_leaflet_image_generation.sql
```

リーフ画像生成では、少なくとも以下のStorage bucketが必要です。

```text
leaflet-images
```

## 主要ディレクトリ

```text
app/                 Next.js App Router
components/          画面コンポーネント
lib/calc/            金額・数量計算
lib/assort/          アソート候補作成
lib/import/          見積書取込
lib/leaf/            リーフPDF/画像生成
lib/parse/           規格・入数・最小ロット等のパース
scripts/             確認用スクリプト
supabase/migrations/ DB migration
worker/              非同期ジョブ・画像生成ワーカー
```

## 検証

通常は以下を実行します。

```bash
npm test
npm run build
```

ローカルのNode実行アーキテクチャと `node_modules` のネイティブ依存がズレると、VitestやNext buildが起動前に失敗する場合があります。その場合は、Nodeと `node_modules` のアーキテクチャを揃えて再インストールしてください。

## 今後の主な作業

- 実見積書からの商品画像抽出精度確認
- リーフ画像の実商品データでの見た目調整
- アソート候補の精度改善
- ワーカー実行環境でのPNG生成確認
- OCR/PDF表抽出の拡張
- 営業メール生成・送信導線の追加
