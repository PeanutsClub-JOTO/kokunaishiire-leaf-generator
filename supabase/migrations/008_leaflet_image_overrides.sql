-- 008: リーフごとの商品画像調整（拡大率・位置）を保存する
--
-- image_overrides: { "<product_id>": { "scale": 100, "x": 0, "y": 0 }, ... }
--   scale: 70〜200 (%) / x: -200〜200 (px) / y: -150〜150 (px)
-- ワークベンチで調整 → 保存 → 再レンダリングで最終PNGにも反映される。

alter table leaflets add column if not exists image_overrides jsonb;
