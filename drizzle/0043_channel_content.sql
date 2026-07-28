-- 0043_channel_content.sql
-- Per-channel title/description overrides (docs/tiktok-readiness-spec.md).
-- products.title/description are shared; a row here lets a channel use its own copy.
CREATE TABLE IF NOT EXISTS channel_content (
  product_id       TEXT NOT NULL,
  platform         TEXT NOT NULL,
  title            TEXT,
  description      TEXT,
  meta_description TEXT,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, platform)
);
