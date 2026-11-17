-- Per-shop TikTok listings and prices (IE + Sell Across Europe shops FR/ES/IT).
-- One row per (product, shop region). `price` is the price WE want (EUR); live_* is what TikTok last showed.
-- IE prices come from Shopify (shopify_tiktok); FR/ES/IT prices are pushed by Wizhard (prices/update).
CREATE TABLE IF NOT EXISTS `tiktok_shop_listings` (
  `product_id`        TEXT NOT NULL REFERENCES `products`(`id`),
  `region`            TEXT NOT NULL,
  `price`             REAL,
  `for_sale`          INTEGER NOT NULL DEFAULT 1,
  `tiktok_product_id` TEXT,
  `tiktok_sku_id`     TEXT,
  `live_price`        REAL,
  `currency`          TEXT,
  `live_status`       TEXT,
  `audit_status`      TEXT,
  `last_seen_at`      TEXT,
  `price_pushed_at`   TEXT,
  `updated_at`        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`product_id`, `region`)
);
