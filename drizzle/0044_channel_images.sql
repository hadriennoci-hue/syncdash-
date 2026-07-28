-- 0044_channel_images.sql
-- Per-channel image set (TikTok gets its squared 1:1 white-bg set; others keep product_images).
CREATE TABLE IF NOT EXISTS channel_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  platform   TEXT NOT NULL,
  url        TEXT NOT NULL,
  position   INTEGER DEFAULT 0,
  alt        TEXT,
  width      INTEGER,
  height     INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_channel_images ON channel_images(product_id, platform);
