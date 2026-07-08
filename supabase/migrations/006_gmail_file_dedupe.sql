-- Gmail添付の二重取込防止。
-- 同一Gmailメッセージ内で同じ内容の添付を再投入しても、quotation/jobsを重複作成しない。

ALTER TABLE gmail_estimate_files
  ADD COLUMN IF NOT EXISTS file_sha256 text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_estimate_files_message_sha256
  ON gmail_estimate_files(message_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;
