-- 011: 自動削除 + OCRプロンプト自動チューニング
--
-- 1. quotations.expires_at — 半年後自動削除用
-- 2. ocr_prompts — プロンプトバージョン管理
-- 3. import_metrics — インポート精度追跡
-- 4. ocr_golden_tests — 回帰テスト用ゴールデンデータ
-- 5. ocr_tune_logs — チューニング履歴

-- ━━━ 1. 見積書に有効期限カラム追加 ━━━
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 既存レコードは created_at + 6ヶ月 をセット
UPDATE quotations
SET expires_at = created_at + interval '6 months'
WHERE expires_at IS NULL;

-- 今後のデフォルト
ALTER TABLE quotations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '6 months');

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_quotations_expires_at
  ON quotations (expires_at)
  WHERE expires_at IS NOT NULL;

-- ━━━ 2. OCRプロンプトバージョン管理 ━━━
CREATE TABLE IF NOT EXISTS ocr_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL,
  system_prompt text NOT NULL,
  user_prompt text NOT NULL DEFAULT '添付の見積書から、全商品の情報をJSONで抽出してください。',
  is_active boolean NOT NULL DEFAULT false,
  -- チューニングで生成された場合の根拠
  tuning_reason text,
  -- 回帰テストの結果サマリ
  regression_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 一意のバージョン番号
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_prompts_version
  ON ocr_prompts (version);

-- アクティブプロンプトは常に1つだけ
CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_prompts_active
  ON ocr_prompts (is_active) WHERE is_active = true;

-- ━━━ 3. インポート精度メトリクス ━━━
CREATE TABLE IF NOT EXISTS import_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  -- OCR結果
  ocr_confidence real,
  prompt_version int,
  -- フィールド充足率 (nullでないフィールド数 / 全フィールド数)
  field_fill_rate real,
  -- パースエラー率 (パースエラー数 / 商品数)
  parse_error_rate real,
  -- 抽出商品数
  product_count int NOT NULL DEFAULT 0,
  -- パースエラーの内訳
  parse_errors jsonb,
  -- 失敗した場合のエラーメッセージ
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_metrics_created
  ON import_metrics (created_at DESC);

-- ━━━ 4. ゴールデンテスト (回帰テスト用) ━━━
CREATE TABLE IF NOT EXISTS ocr_golden_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 元データ参照（削除されても残す）
  source_quotation_id uuid,
  source_job_id uuid,
  -- テスト入力: 見積書ファイルのStorageパス
  file_storage_path text NOT NULL,
  file_mime_type text NOT NULL,
  -- 期待出力: 正しく抽出された商品データ
  expected_products jsonb NOT NULL,
  expected_confidence real NOT NULL,
  -- メタデータ
  maker_name text,
  product_count int NOT NULL,
  -- ゴールデンテストとして有効か
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ━━━ 5. チューニング履歴 ━━━
CREATE TABLE IF NOT EXISTS ocr_tune_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- トリガーとなった条件
  trigger_reason text NOT NULL,
  -- 分析した失敗インポートのjob_id群
  analyzed_job_ids uuid[] NOT NULL DEFAULT '{}',
  -- 生成された新プロンプトのバージョン
  new_prompt_version int,
  -- 回帰テスト結果
  regression_passed boolean,
  regression_details jsonb,
  -- 最終的にプロンプトが採用されたか
  prompt_adopted boolean NOT NULL DEFAULT false,
  -- 処理ログ
  analysis_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
