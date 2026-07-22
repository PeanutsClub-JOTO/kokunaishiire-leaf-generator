# 企画業務自動化システム

ピーナッツクラブ 国内仕入部向けの、見積書取り込みから企画リーフ作成までを支援する社内Webアプリです。

メーカーから届く見積書・商品リスト・発注書などの資料をもとに、商品情報の構造化、商品画像の紐付け、金額条件判定、アソート候補作成、リーフ画像生成、企画確定後のGoogle Drive転送までを一連の業務として扱います。

## 現フェーズの位置づけ

今回の完成範囲は、手元の見積書・PDF・Excel・Googleスプレッドシートを人が取り込み、システム上で内容確認・リーフ編集・企画確定まで行う運用です。

メールからの完全自動取り込み、営業担当への自動メール送信、営業向けの配信管理は、今後の拡張フェーズとして切り離しています。

## 完成済みの主な機能

### 見積書取り込み

取り込み画面から、Excel / PDF / Googleスプレッドシートを見積データとして登録できます。

対応形式:

- `.xlsx`
- `.xls`
- `.pdf`
- GoogleスプレッドシートURL
- 複数Excel資料の同時取り込み

複数資料を同時に取り込む場合、商品リスト、見積書、発注書など役割が分かれていても、商品名・JANコード・GTINコード・近接テキスト・商品画像情報を使って同じ商品として統合します。

### OCR / 商品情報抽出

PDFや画像化された帳票はGeminiでOCRし、商品行だけをJSONとして抽出します。

抽出対象:

- 商品番号
- メーカー名
- 商品名
- 規格、容量、サイズ
- 入数、入り数、ケース入数、梱入数
- 最小ロット、発注単位、MOQ
- 上代、希望小売価格、参考売価
- 単価、原価、仕入価格、仕切価格、納価、NET価格
- JANコード、GTINコード
- 賞味期限、保存期間
- 販売期間
- 備考、分類、特記事項

合計行、小計行、送料、条件欄、配送条件、見出し行、ページ番号、装飾文字、商品画像だけの領域は商品として扱いません。

### Excelセル解析

Excel帳票は、セルの値とレイアウトを読み取り、列位置だけに依存しない抽出を行います。

特に以下の揺れに対応します。

- 列順が帳票ごとに違う
- 「単価」「仕切」「NET価格」など価格列の名前が違う
- 「入数」「梱入数」「ケース入数」など表記が違う
- 商品名が複数列に分かれている
- 見積書と商品リストで情報が分散している
- 画像付き商品リストと価格表が別ファイルになっている

### 商品画像抽出と紐付け

Excel内の商品画像を抽出し、商品情報に紐付けます。

紐付けの優先順位:

1. JANコード、GTINコードなどのコード一致
2. 商品名、品名、近接テキストの一致
3. 画像の周辺セル、行位置、ブロック位置
4. シート上の順番
5. 怪しいケースでは画像特徴による再判定

商品画像そのものはAIで描き直さず、見積書や商品リストから取得した実画像をリーフ上に合成します。

### 複数資料の統合

同じメールや同じ案件内に、役割の違う資料が複数あるケースに対応しています。

例:

- 商品リスト: 商品名、JAN、画像、入数がある
- 見積書: 上代、仕入単価、納価がある
- 発注書: 発注単位、最低数量がある

この場合、資料ごとに抽出した情報を商品単位で統合し、同じ商品に対して価格・入数・画像・コード類が正しく集約されるようにしています。

### 金額計算

ゲームセンター向け掲載条件に合わせて、1ロットあたりの原価、掲載入数、卸価格、掲載単価、ハーフ可否を自動計算します。

基本仕様:

- 入数から発注ロット数を計算
- 最小ロットがない場合は、入数を1ロットとして扱う
- 1ロット原価をもとに、上限金額内で最大ロット数を計算
- 仕入原価合計をもとに卸売価格を計算
- 掲載単価が上限を超える場合は企画対象外として警告

卸売価格の計算:

```text
卸売価格 = 仕入原価合計 ÷ 0.75 + 3,000円
```

発注ロット数の計算は、入数と最小ロットをもとにした既存ロジックを維持しています。

### アソート候補作成

同じメーカー、近い価格帯、同じ入数条件、近い商品カテゴリの商品をグルーピングし、アソート候補を作成します。

できること:

- 単品リーフの自動作成
- アソート候補の作成
- アソート比率の編集
- 比率変更後の金額再計算
- 条件外アソートの警告
- 単品確定時のアソート確認

### リーフワークベンチ

取り込み後の商品を、リーフ画像として確認・編集する画面です。

編集できる内容:

- 掲載名
- キャッチコピー
- セールスコピー
- 受注後納期
- 商品コード
- PJ番号
- 商品画像の拡大率
- 商品画像の横位置、縦位置
- アソート構成、比率

保存すると、編集内容を反映したリーフ画像を再生成します。

### AI背景生成

ワークベンチでは、任意のタイミングでAI背景画像を生成・再生成できます。

背景生成の考え方:

- 商品画像はAIで生成しない
- 実商品画像はそのまま使用する
- Gemini画像生成は背景だけに使う
- 商品カテゴリ、色味、季節感、景品向けの雰囲気を背景に反映する
- 商品パッケージや架空商品を背景内に描かない

取り込み画面側の自動生成ON/OFF導線は隠していますが、ワークベンチ上の「背景を生成 / 背景を再生成」ボタンは使用します。

### リーフ画像生成

最終的な横長リーフ画像をPNGとして生成します。

掲載情報:

- 商品画像
- 商品名
- キャッチコピー
- セールスコピー
- アイテム数
- 掲載入数
- 卸価格
- 掲載単価
- 商品サイズ
- 賞味期限
- 受注後納期
- ハーフ可否
- PJ番号
- 商品コード

リーフ画像のテンプレートは `lib/leaf/image-template.html`、生成処理は `lib/leaf/generate-image.ts` にあります。

### 企画確定とGoogle Drive転送

ワークベンチで「企画確定してDriveへ送る」を押すと、リーフを確定状態にし、PNG画像を指定のGoogle Driveフォルダへ転送します。

流れ:

```text
リーフ画像を確認
  ↓
企画確定
  ↓
leaflets.status = final
  ↓
final_visible_until を3日後に設定
  ↓
jobs に export_final_leaflet_to_drive を登録
  ↓
ワーカーが確定リーフPNGをGoogle Driveへアップロード
  ↓
drive_url / drive_export_status を更新
```

確定済みリーフは `/final-leaflets` に3日間表示されます。

### パスワード認証

本番URLにアクセスしたとき、環境変数で設定したパスワードを求める簡易認証ゲートを用意しています。

対応環境変数:

```text
APP_ACCESS_PASSWORD=
APP_AUTH_SECRET=
```

互換用として `SITE_PASSWORD` と `BASIC_AUTH_PASSWORD` も参照します。`APP_ACCESS_PASSWORD` が未設定の場合、認証ゲートは無効になります。

## 非同期ワーカー

重い処理は画面操作から切り離し、`jobs` テーブルにジョブを登録してワーカーが処理します。

対象処理:

- PDF取り込み
- Excel取り込み
- 複数資料取り込み
- リーフ画像生成
- AI背景生成付きリーフ画像生成
- 確定リーフのGoogle Drive転送

リーフ画像生成ではChrome / Puppeteerを使うため、APIリクエスト内で直接処理するとタイムアウトしやすくなります。そのため、画面側はジョブ登録までを行い、ワーカーが裏でPNGを生成してStorageに保存します。

## 今後の拡張フェーズ

以下は今回の完成範囲から切り離し、今後の拡張として扱います。

### メールからの自動取り込み

Gmail上の見積候補メールを自動検出し、添付ファイルを取り込み対象として登録する構想です。

想定機能:

- Gmail検索条件による見積候補メールの検出
- 処理済みラベルの付与
- raw EMLの保管
- 添付ファイルの保存
- PDF / XLSX / XLS の自動取り込み
- メール本文からメーカー名、案件名、担当者情報を補助抽出
- 重複メール、重複添付の判定
- 取込失敗時の再実行導線

現状は入口APIと保管・取り込みに流す土台を持っていますが、完全自動運用は今後フェーズです。

関連ファイル:

- `app/api/gmail/scan/route.ts`
- `app/api/gmail/ingest/route.ts`
- `lib/gmail/estimate-ingest.ts`
- `worker/handlers/gmail-scan.ts`
- `worker/handlers/import-eml.ts`

### 営業への自動メール送信

確定リーフを営業担当へ自動送信する構想です。

想定機能:

- 確定リーフPNGまたはDriveリンクのメール添付
- 営業担当、部署、メーカー別の宛先管理
- 件名、本文テンプレートの自動生成
- 送信前プレビュー
- 手動承認後の送信
- 送信履歴の保存
- 再送、差し戻し、送信停止

現フェーズでは、確定リーフをDriveへ転送し、3日間確認できるところまでを完成範囲にしています。

### 営業向け配信・承認フロー

将来的には、営業が確認しやすい専用画面や承認フローを追加できます。

想定機能:

- 営業向けの確定リーフ一覧
- メーカー、カテゴリ、販売期間での絞り込み
- 承認、差し戻しコメント
- 既読、未読、対応済みステータス
- 企画ごとの送付履歴

### OCR精度の継続改善

帳票フォーマットが増えるほど、抽出プロンプトや補正ロジックを改善できます。

想定機能:

- 低信頼度抽出の検知
- 失敗帳票のサンプル保存
- メーカー別の補正ルール
- JANコード、商品名、画像特徴を使った再照合
- OCRプロンプトの改善履歴管理

## 開発コマンド

```bash
npm run dev
npm test
npm run build
```

ワーカーをローカルで動かす場合:

```bash
npm run worker
```

このプロジェクトでは Next.js 16 を使用しています。`npm run build` は環境差でTurbopackが落ちやすかったため、`next build --webpack` にしています。

## デプロイ前チェック

```bash
npm ci
npm test
npm run build
```

VercelでWebアプリを公開する場合、Vercel側に本番用の環境変数を設定してRedeployします。Railwayでワーカーや別サービスを動かす場合も、Railway側に同じく必要な環境変数を設定します。

## 環境変数

主な環境変数:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

APP_ACCESS_PASSWORD=
APP_AUTH_SECRET=

GEMINI_API_KEY=
LLM_MODEL=gemini-3.1-flash-lite
IMAGE_GEN_MODEL=gemini-3.1-flash-lite-image

GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID=

WORKER_BASE_URL=
RENDERER_PORT=3001
NOTO_FONT_URL=
PUPPETEER_LAUNCH_TIMEOUT_MS=60000

GMAIL_ESTIMATE_QUERY=
GMAIL_PROCESSED_LABEL=
```

補足:

- `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` は画面表示側で必要です。
- `SUPABASE_SERVICE_ROLE_KEY` はサーバー側の登録、更新、ワーカー処理で必要です。
- `APP_ACCESS_PASSWORD` を設定するとパスワード認証が有効になります。
- `LLM_MODEL` はOCR、キャッチコピー、背景プロンプト、アソート補助に使います。
- `IMAGE_GEN_MODEL` はAI背景画像だけに使います。
- `GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID` は確定リーフPNGの転送先フォルダIDです。
- Google Driveの転送先フォルダは、`GOOGLE_SERVICE_ACCOUNT_EMAIL` のサービスアカウントに編集権限で共有してください。
- `WORKER_BASE_URL` がある場合、リーフ画像生成はワーカーへ委譲します。未設定の場合はローカルで直接生成します。

## DB / Storage

Supabaseを使用します。

Migration:

```text
supabase/migrations/
```

主なStorage bucket:

```text
quotation-files
product-images
leaflet-images
gmail-estimates
```

## 主要ディレクトリ

```text
app/                 Next.js App Router
components/          画面コンポーネント
lib/calc/            金額・数量計算
lib/assort/          アソート候補作成
lib/import/          見積書取込、OCR、Excel画像抽出
lib/leaf/            リーフ画像、AI背景、PDF生成
lib/parse/           規格、入数、最小ロット等のパース
lib/google/          Google Drive転送
lib/gmail/           Gmail取込拡張の土台
lib/auth/            パスワード認証
scripts/             確認用スクリプト
supabase/migrations/ DB migration
worker/              非同期ジョブ、画像生成、Drive転送
```

## 画面URL

```text
/                         見積書取り込み画面
/quotations/[id]/products  取り込み商品の確認
/quotations/[id]/assort    アソート判定結果
/quotations/[id]/leaflets  リーフワークベンチ
/final-leaflets            確定リーフ一覧
/login                     パスワード認証
/mock                      モック確認画面
```

## 検証

通常は以下を実行します。

```bash
npm test
npm run build
```

ローカルのNode実行アーキテクチャと `node_modules` のネイティブ依存がズレると、VitestやNext buildが起動前に失敗する場合があります。その場合は、Nodeと `node_modules` のアーキテクチャを揃えて再インストールしてください。
