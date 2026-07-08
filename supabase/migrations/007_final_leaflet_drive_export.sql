-- ============================================================
-- 確定リーフのGoogle Drive転送・3日表示・アソート再利用確認
-- ============================================================

ALTER TABLE leaflets
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_visible_until timestamptz,
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_url text,
  ADD COLUMN IF NOT EXISTS drive_export_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS drive_export_error text,
  ADD COLUMN IF NOT EXISTS assort_followup_status text NOT NULL DEFAULT 'unasked';

ALTER TABLE leaflets DROP CONSTRAINT IF EXISTS leaflets_drive_export_status_check;
ALTER TABLE leaflets
  ADD CONSTRAINT leaflets_drive_export_status_check
  CHECK (drive_export_status IN ('none', 'pending', 'exporting', 'done', 'error'));

ALTER TABLE leaflets DROP CONSTRAINT IF EXISTS leaflets_assort_followup_status_check;
ALTER TABLE leaflets
  ADD CONSTRAINT leaflets_assort_followup_status_check
  CHECK (assort_followup_status IN ('unasked', 'not_needed', 'accepted', 'declined'));

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_type_check
  CHECK (
    job_type IN (
      'import_xlsx',
      'import_gsheet',
      'import_pdf',
      'import_image_pdf',
      'import_eml',
      'gmail_scan',
      'gmail_ingest_message',
      'generate_pdf',
      'render_leaflet_image',
      'export_final_leaflet_to_drive'
    )
  );

CREATE INDEX IF NOT EXISTS idx_leaflets_final_visible_until
  ON leaflets(final_visible_until)
  WHERE status = 'final';

CREATE INDEX IF NOT EXISTS idx_leaflets_drive_export_status
  ON leaflets(drive_export_status);
