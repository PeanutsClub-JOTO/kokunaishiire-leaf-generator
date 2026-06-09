-- ============================================================
-- Storage バケット定義
--
-- コードが参照する 4 バケットを冪等に作成する。
-- これが無いと:
--   - quotation-files: 見積書アップロード/取込が失敗
--   - product-images : 商品画像が保存されず、リーフ画像に商品画像が出ない
--   - leaflet-images : リーフ画像PNGが保存できない
--   - leaflet-pdfs   : リーフPDFが保存できない
--
-- public 設定:
--   product-images / leaflet-images / leaflet-pdfs は getPublicUrl で
--   公開URLを生成して参照するため public=true。
--   quotation-files は原本（社外秘）のため public=false。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('quotation-files', 'quotation-files', false),
  ('product-images',  'product-images',  true),
  ('leaflet-images',  'leaflet-images',  true),
  ('leaflet-pdfs',    'leaflet-pdfs',     true)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- アクセスポリシー
-- ・公開バケットは匿名でも読み取り可（公開URLで参照するため）
-- ・書き込み/更新/削除は認証済みユーザー（= service role 含む）のみ
-- ・quotation-files は読み取りも認証済みのみ
-- ------------------------------------------------------------

-- 公開3バケットの読み取り（anon/authenticated）
DROP POLICY IF EXISTS "public_buckets_read" ON storage.objects;
CREATE POLICY "public_buckets_read" ON storage.objects
  FOR SELECT
  USING (bucket_id IN ('product-images', 'leaflet-images', 'leaflet-pdfs'));

-- quotation-files は認証済みのみ読み取り
DROP POLICY IF EXISTS "quotation_files_read" ON storage.objects;
CREATE POLICY "quotation_files_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'quotation-files');

-- 全バケットの書き込みは認証済みのみ
DROP POLICY IF EXISTS "authenticated_write" ON storage.objects;
CREATE POLICY "authenticated_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('quotation-files', 'product-images', 'leaflet-images', 'leaflet-pdfs'));

DROP POLICY IF EXISTS "authenticated_update" ON storage.objects;
CREATE POLICY "authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('quotation-files', 'product-images', 'leaflet-images', 'leaflet-pdfs'));

DROP POLICY IF EXISTS "authenticated_delete" ON storage.objects;
CREATE POLICY "authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('quotation-files', 'product-images', 'leaflet-images', 'leaflet-pdfs'));
