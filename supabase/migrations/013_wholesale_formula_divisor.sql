-- 卸売価格計算を「原価合計 ÷ 0.75 + 営業上乗せ額」に変更。
-- 既存キー名 profit_coef は互換維持のためそのまま使い、値の意味を「掛率」から「除数」に変更する。
UPDATE app_settings
SET value = 0.75,
    updated_at = now()
WHERE key = 'profit_coef'
  AND value = 1.25;
