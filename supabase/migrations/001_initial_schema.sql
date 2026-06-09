-- ============================================================
-- 企画業務自動化システム 初期スキーマ (仕様書 v2.1 §3 準拠)
-- ============================================================

-- 案件 = 見積書ファイル
CREATE TABLE IF NOT EXISTS quotations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('gsheet', 'xlsx', 'pdf')),
  source_ref  text,              -- スプレッドシートID / ファイルパス
  client_name text,
  quoted_at   date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- シート = 1メーカー単位（アソートの境界）
CREATE TABLE IF NOT EXISTS sheets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  sheet_name    text,
  maker_name    text
);

-- 商品
CREATE TABLE IF NOT EXISTS products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id            uuid NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  no                  int,                    -- ①〜⑫（表示順 / 画像対応キー）
  maker_name          text,
  product_name        text,
  spec_raw            text,                   -- 規格の原文
  spec_pieces         int,                    -- 規格を個数として解釈できた場合
  spec_grams          numeric,               -- 規格を内容量(g)として解釈できた場合
  irisu_raw           text,                   -- 入数原文（例: "12×1"）
  case_qty            int,                    -- ケース入数（A×BのA）
  lots_per_kou        int,                    -- 甲あたりケース数（Bが無ければ1）
  min_lot_raw         text,                   -- 最小ロット原文（例: "1ケース"）
  min_lot_qty         int,                    -- 最小ロット実数量（個）
  retail_price        numeric,               -- 上代
  cost                numeric,               -- 原価（見積書の「単価」列）
  jan_code            text,
  shelf_life_days     int,                    -- 賞味期限残日数
  sales_period_raw    text,                   -- 販売期間原文
  sales_period_start  date,                  -- パース結果
  sales_period_end    date,                  -- パース結果
  piece_size          text,                   -- ピース寸法
  image_url           text,                   -- Supabase Storage参照
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- アソート構成候補グループ
CREATE TABLE IF NOT EXISTS assort_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id   uuid NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  group_key  text,          -- 正規化キー: maker|spec_norm|irisu|retail_bucket
  is_single  bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- アソート構成商品と比率
CREATE TABLE IF NOT EXISTS assort_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES assort_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ratio      int NOT NULL DEFAULT 1    -- 比率（初期値=1: 均等）
);

-- リーフ
CREATE TABLE IF NOT EXISTS leaflets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES assort_groups(id) ON DELETE CASCADE,
  product_code     text,           -- 人が後入力。末尾'$'=直送を許容
  pj_no            text,           -- PJ番号（社員番号）
  leaf_name        text,           -- 掲載品名（アソートは品名を文字結合）
  item_count       int,            -- アイテム数（単品=1, アソート=種類数）
  leaf_qty         int,            -- リーフ掲載入数
  cost_total       numeric,       -- 仕入原価合計
  wholesale_price  numeric,       -- 卸価格
  unit_price       numeric,       -- 1個あたり単価
  is_half_ok       bool,           -- ハーフ可否
  lead_time        text,           -- 納期（未記載は「受注後約1週間」）
  shelf_life_days  int,
  piece_size       text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  pdf_url          text,
  leaf_image_url   text,            -- PNG画像版URL（leaflet-imagesバケット）
  leaf_pdf_url     text,            -- PDF版URL（leaflet-pdfsバケット、pdf_urlと同義）
  template_version text,            -- 使用テンプレートバージョン
  render_status    text NOT NULL DEFAULT 'pending',  -- pending / rendering / done / error
  render_error     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 注意フラグ（除外条件ではない補助情報）
CREATE TABLE IF NOT EXISTS alert_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('product', 'leaflet', 'group')),
  target_id   uuid NOT NULL,
  flag_code   text NOT NULL,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 取込ジョブ（非同期）
CREATE TABLE IF NOT EXISTS jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id   uuid REFERENCES quotations(id) ON DELETE SET NULL,
  target_id      uuid,              -- 対象リーフIDなど（render_leaflet_imageで使用）
  job_type       text NOT NULL CHECK (job_type IN ('import_xlsx', 'import_gsheet', 'import_pdf', 'import_image_pdf', 'generate_pdf', 'render_leaflet_image')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress       int NOT NULL DEFAULT 0,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

-- 設定（定数のパラメータ化。コード直書き禁止）
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- §4 デフォルト定数を挿入
INSERT INTO app_settings (key, value) VALUES
  ('profit_coef',      1.25),   -- 卸価格係数（25%利益）
  ('sales_add',        3000),   -- 営業上乗せ額
  ('unit_price_cap',   1000),   -- 単価通過ゲート上限
  ('cost_cap',         33000),  -- 仕入原価上限（数量サイジングの天井）
  ('half_base',        16500),  -- ハーフ可否基準（= cost_cap / 2）
  ('shelf_min_days',   90),     -- 賞味期限通過基準（≧で通過）
  ('retail_tolerance', 0)       -- アソート主判定の上代許容差（0=完全一致）
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sheets_quotation_id      ON sheets(quotation_id);
CREATE INDEX IF NOT EXISTS idx_products_sheet_id        ON products(sheet_id);
CREATE INDEX IF NOT EXISTS idx_assort_groups_sheet_id   ON assort_groups(sheet_id);
CREATE INDEX IF NOT EXISTS idx_assort_items_group_id    ON assort_items(group_id);
CREATE INDEX IF NOT EXISTS idx_assort_items_product_id  ON assort_items(product_id);
CREATE INDEX IF NOT EXISTS idx_leaflets_group_id        ON leaflets(group_id);
CREATE INDEX IF NOT EXISTS idx_alert_flags_target       ON alert_flags(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status              ON jobs(status);

-- ============================================================
-- RLS（第1段階: 認証済みユーザーのみアクセス可）
-- ============================================================
ALTER TABLE quotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assort_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE assort_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaflets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_flags   ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings  ENABLE ROW LEVEL SECURITY;

-- 第1段階: 認証済みユーザーは全操作可（将来は管理者/一般の分離を追加）
CREATE POLICY "authenticated_all" ON quotations    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON sheets        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON products      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON assort_groups FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON assort_items  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON leaflets      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON alert_flags   FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON jobs          FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON app_settings  FOR ALL USING (auth.role() = 'authenticated');
