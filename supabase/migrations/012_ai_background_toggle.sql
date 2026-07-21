-- 012: AI背景画像生成をオプトイン化
--
-- これまで見積書取り込み時に全リーフへ自動でAI背景を生成していたが、
-- Gemini画像生成モデルのコストが高く（1枚あたり数円）、確認前のリーフにも
-- 無条件に課金が発生していた。
--
-- 今後は既定でOFF。取り込み画面でチェックを入れた場合のみ自動生成し、
-- 通常はワークベンチの「背景を生成」ボタンを押したときだけ生成する。

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS ai_background_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE leaflets
  ADD COLUMN IF NOT EXISTS ai_background_enabled boolean NOT NULL DEFAULT false;
