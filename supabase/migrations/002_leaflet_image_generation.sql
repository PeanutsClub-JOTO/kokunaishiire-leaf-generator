-- ============================================================
-- リーフ画像生成対応
-- ============================================================

ALTER TABLE leaflets
  ADD COLUMN IF NOT EXISTS leaf_image_url text,
  ADD COLUMN IF NOT EXISTS leaf_pdf_url text,
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS render_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS render_error text;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS target_id uuid,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
  CHECK (job_type IN (
    'import_xlsx',
    'import_gsheet',
    'import_pdf',
    'import_image_pdf',
    'generate_pdf',
    'render_leaflet_image'
  ));

CREATE INDEX IF NOT EXISTS idx_jobs_target_id ON jobs(target_id);
