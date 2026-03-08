-- Migration 23: Ads campaign planning + publishing pipeline

CREATE TABLE IF NOT EXISTS ads_providers (
  provider_id      TEXT PRIMARY KEY, -- google_ads | meta_ads | tiktok_ads
  label            TEXT NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ads_accounts (
  account_pk           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id          TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_external_id  TEXT NOT NULL, -- customer_id / act_xxx / advertiser_id
  account_name         TEXT NOT NULL,
  currency_code        TEXT,
  timezone             TEXT,
  status               TEXT NOT NULL DEFAULT 'active',
  config_json          TEXT, -- optional provider-specific settings
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_id, account_external_id)
);

CREATE TABLE IF NOT EXISTS ads_campaigns (
  campaign_pk            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_pk             INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  provider_campaign_id   TEXT, -- set after publish
  name                   TEXT NOT NULL,
  objective              TEXT NOT NULL, -- sales/traffic/leads/etc.
  status                 TEXT NOT NULL DEFAULT 'draft', -- draft|approved|scheduled|live|paused|completed|canceled
  start_at               TEXT,
  end_at                 TEXT,
  budget_mode            TEXT NOT NULL DEFAULT 'daily', -- daily|lifetime
  budget_amount_cents    INTEGER,
  currency_code          TEXT,
  targeting_json         TEXT, -- geo/age/interests/lookalike...
  tracking_json          TEXT, -- utm/pixel/conversion event...
  notes                  TEXT,
  created_by             TEXT NOT NULL DEFAULT 'human', -- human|agent|system
  approved_by            TEXT,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_pk, provider_campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_campaigns_account_status
  ON ads_campaigns(account_pk, status, start_at);

CREATE TABLE IF NOT EXISTS ads_ad_sets (
  ad_set_pk              INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_pk            INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  provider_ad_set_id     TEXT, -- set after publish
  name                   TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft',
  optimization_goal      TEXT,
  billing_event          TEXT,
  bid_amount_cents       INTEGER,
  schedule_start_at      TEXT,
  schedule_end_at        TEXT,
  budget_mode            TEXT, -- daily|lifetime|inherit
  budget_amount_cents    INTEGER,
  targeting_json         TEXT,
  placements_json        TEXT,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_pk, provider_ad_set_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_ad_sets_campaign
  ON ads_ad_sets(campaign_pk, status);

CREATE TABLE IF NOT EXISTS ads_creatives (
  creative_pk            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_pk            INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  ad_set_pk              INTEGER REFERENCES ads_ad_sets(ad_set_pk) ON DELETE SET NULL,
  provider_creative_id   TEXT, -- set after publish
  name                   TEXT,
  primary_text           TEXT,
  headline               TEXT,
  description            TEXT,
  destination_url        TEXT,
  cta                    TEXT,
  media_type             TEXT NOT NULL DEFAULT 'image', -- image|video|carousel
  media_urls_json        TEXT, -- up to N asset URLs
  thumbnail_url          TEXT,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ads_creatives_campaign
  ON ads_creatives(campaign_pk);

CREATE TABLE IF NOT EXISTS ads_publish_jobs (
  job_pk                 INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id            TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_pk             INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  target_type            TEXT NOT NULL, -- campaign|ad_set|creative
  target_pk              INTEGER NOT NULL,
  action                 TEXT NOT NULL, -- create|update|pause|resume|delete|publish
  scheduled_for          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'queued', -- queued|running|success|error|canceled
  attempts               INTEGER NOT NULL DEFAULT 0,
  max_attempts           INTEGER NOT NULL DEFAULT 3,
  idempotency_key        TEXT,
  last_error             TEXT,
  request_json           TEXT,
  response_json          TEXT,
  started_at             TEXT,
  finished_at            TEXT,
  created_by             TEXT NOT NULL DEFAULT 'system',
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ads_publish_jobs_idempotency
  ON ads_publish_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ads_publish_jobs_sched
  ON ads_publish_jobs(status, scheduled_for);

INSERT OR IGNORE INTO ads_providers (provider_id, label, is_active)
VALUES
  ('google_ads', 'Google Ads', 1),
  ('meta_ads', 'Meta Ads', 1),
  ('tiktok_ads', 'TikTok Ads', 1);
