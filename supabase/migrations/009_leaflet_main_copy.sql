-- 009: リーフごとのキャッチコピー（メインコピー）ユーザー編集値
--
-- main_copy_override: NULL のときは AI (catchphrase.main_copy) → ルールベース
--   の順にフォールバック。値が入っていればそれを最優先で表示する。

alter table leaflets add column if not exists main_copy_override text;
