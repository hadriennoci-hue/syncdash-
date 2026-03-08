-- Migration 21: Social media publishing pipeline

CREATE TABLE IF NOT EXISTS social_media_accounts (
  id            TEXT PRIMARY KEY, -- coincart_x, komputerzz_x
  label         TEXT NOT NULL,
  platform      TEXT NOT NULL,    -- x, instagram, etc.
  handle        TEXT NOT NULL,    -- @coincartstore
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_media_posts (
  post_pk         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      TEXT NOT NULL REFERENCES social_media_accounts(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  image_url       TEXT,
  scheduled_for   TEXT NOT NULL,  -- ISO datetime
  status          TEXT NOT NULL DEFAULT 'suggested', -- suggested|validated|canceled|published
  external_post_id TEXT,
  published_at    TEXT,
  created_by      TEXT NOT NULL DEFAULT 'agent',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_social_media_posts_account_sched
  ON social_media_posts(account_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_social_media_posts_status_sched
  ON social_media_posts(status, scheduled_for);

INSERT OR IGNORE INTO social_media_accounts (id, label, platform, handle, is_active)
VALUES
  ('coincart_x', 'Coincart', 'x', '@coincartstore', 1),
  ('komputerzz_x', 'Komputerzz', 'x', '@komputerzz', 1);
