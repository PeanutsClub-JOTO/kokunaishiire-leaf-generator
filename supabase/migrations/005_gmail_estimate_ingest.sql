-- ============================================================
-- Gmail 見積書自動取込の大枠
--
-- Gmailから取得したメール/添付を一度アーカイブし、
-- PDF/XLSX/XLS は既存 quotation import pipeline に流す。
-- EML は現段階では保管のみ。後続で import_eml に展開処理を実装する。
-- ============================================================

-- source_type / job_type の拡張
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_source_type_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_source_type_check
  CHECK (source_type IN ('gsheet', 'xlsx', 'pdf', 'eml'));

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
      'render_leaflet_image'
    )
  );

CREATE TABLE IF NOT EXISTS gmail_estimate_messages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id       text NOT NULL UNIQUE,
  gmail_thread_id        text,
  subject                text,
  from_address           text,
  received_at            timestamptz,
  snippet                text,
  archive_storage_prefix text,
  gmail_label_applied    bool NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'archived'
    CHECK (status IN ('archived', 'queued', 'processed', 'error')),
  error_message          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gmail_estimate_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES gmail_estimate_messages(id) ON DELETE CASCADE,
  file_name      text NOT NULL,
  mime_type      text,
  storage_path   text NOT NULL,
  file_kind      text NOT NULL CHECK (file_kind IN ('quotation', 'eml', 'unsupported')),
  quotation_id   uuid REFERENCES quotations(id) ON DELETE SET NULL,
  import_job_id  uuid REFERENCES jobs(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'archived'
    CHECK (status IN ('archived', 'queued', 'processed', 'unsupported', 'error')),
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_estimate_messages_gmail_id
  ON gmail_estimate_messages(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_gmail_estimate_files_message_id
  ON gmail_estimate_files(message_id);
CREATE INDEX IF NOT EXISTS idx_gmail_estimate_files_quotation_id
  ON gmail_estimate_files(quotation_id);
CREATE INDEX IF NOT EXISTS idx_gmail_estimate_files_import_job_id
  ON gmail_estimate_files(import_job_id);

ALTER TABLE gmail_estimate_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_estimate_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON gmail_estimate_messages
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_all" ON gmail_estimate_files
  FOR ALL USING (auth.role() = 'authenticated');

-- Gmail原本/添付の保管用バケット。社外秘なので private。
INSERT INTO storage.buckets (id, name, public)
VALUES ('gmail-estimates', 'gmail-estimates', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "quotation_files_read" ON storage.objects;
CREATE POLICY "quotation_files_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('quotation-files', 'gmail-estimates'));

DROP POLICY IF EXISTS "authenticated_write" ON storage.objects;
CREATE POLICY "authenticated_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN (
      'quotation-files',
      'product-images',
      'leaflet-images',
      'leaflet-pdfs',
      'gmail-estimates'
    )
  );

DROP POLICY IF EXISTS "authenticated_update" ON storage.objects;
CREATE POLICY "authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN (
      'quotation-files',
      'product-images',
      'leaflet-images',
      'leaflet-pdfs',
      'gmail-estimates'
    )
  );

DROP POLICY IF EXISTS "authenticated_delete" ON storage.objects;
CREATE POLICY "authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN (
      'quotation-files',
      'product-images',
      'leaflet-images',
      'leaflet-pdfs',
      'gmail-estimates'
    )
  );
