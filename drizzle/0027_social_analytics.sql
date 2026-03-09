-- Migration 27: Social media analytics (account + post daily metrics)

ALTER TABLE social_media_posts ADD COLUMN hypothesis TEXT;
ALTER TABLE social_media_posts ADD COLUMN variant_label TEXT;
ALTER TABLE social_media_posts ADD COLUMN experiment_group TEXT;

CREATE TABLE IF NOT EXISTS social_account_daily_metrics (
  account_id                      TEXT NOT NULL REFERENCES social_media_accounts(id) ON DELETE CASCADE,
  metric_date                     TEXT NOT NULL, -- YYYY-MM-DD
  impressions                     INTEGER NOT NULL DEFAULT 0,
  engagements                     INTEGER NOT NULL DEFAULT 0,
  link_clicks                     INTEGER NOT NULL DEFAULT 0,
  followers_total                 INTEGER,
  followers_delta                 INTEGER NOT NULL DEFAULT 0,
  posts_published                 INTEGER NOT NULL DEFAULT 0,
  source_json                     TEXT,
  updated_at                      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_social_account_daily_metrics_date
  ON social_account_daily_metrics(metric_date);

CREATE TABLE IF NOT EXISTS social_post_daily_metrics (
  post_pk                         INTEGER NOT NULL REFERENCES social_media_posts(post_pk) ON DELETE CASCADE,
  metric_date                     TEXT NOT NULL, -- YYYY-MM-DD
  impressions                     INTEGER NOT NULL DEFAULT 0,
  likes                           INTEGER NOT NULL DEFAULT 0,
  reposts                         INTEGER NOT NULL DEFAULT 0,
  replies                         INTEGER NOT NULL DEFAULT 0,
  bookmarks                       INTEGER NOT NULL DEFAULT 0,
  quotes                          INTEGER NOT NULL DEFAULT 0,
  profile_clicks                  INTEGER NOT NULL DEFAULT 0,
  link_clicks                     INTEGER NOT NULL DEFAULT 0,
  follower_delta_24h              INTEGER,
  follower_delta_72h              INTEGER,
  sentiment_tag                   TEXT,
  reason_tags_json                TEXT,
  source_json                     TEXT,
  updated_at                      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_pk, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_social_post_daily_metrics_date
  ON social_post_daily_metrics(metric_date);
