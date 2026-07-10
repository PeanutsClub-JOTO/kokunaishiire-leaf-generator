-- 010: AI生成キャッチコピー/セールスコピーの保存
--
-- 従来はレンダリング時に生成してPNGに焼き込むだけでDBに残らず、
-- ワークベンチの編集欄に「AIが考えた文章」を表示できなかった。
-- 生成成功時にここへ保存し、編集欄の初期値として表示する。
--   ai_main_copy: AI生成キャッチコピー（メイン）
--   ai_sub_copy : AI生成セールスコピー（サブ）

alter table leaflets add column if not exists ai_main_copy text;
alter table leaflets add column if not exists ai_sub_copy text;
