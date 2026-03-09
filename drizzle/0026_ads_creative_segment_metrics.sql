-- Migration 26: Creative and segment daily metrics for winners/losers and audience breakdowns

CREATE TABLE IF NOT EXISTS ads_creative_daily_metrics (
  campaign_pk                    INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  metric_date                    TEXT NOT NULL, -- YYYY-MM-DD
  provider_id                    TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_pk                     INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  creative_key                   TEXT NOT NULL,
  creative_name                  TEXT,
  creative_preview_url           TEXT,
  impressions                    INTEGER NOT NULL DEFAULT 0,
  clicks                         INTEGER NOT NULL DEFAULT 0,
  spend_cents                    INTEGER NOT NULL DEFAULT 0,
  conversions                    INTEGER NOT NULL DEFAULT 0,
  conversion_value_cents         INTEGER NOT NULL DEFAULT 0,
  source_json                    TEXT,
  updated_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_pk, metric_date, creative_key)
);

CREATE INDEX IF NOT EXISTS idx_ads_creative_daily_provider_date
  ON ads_creative_daily_metrics(provider_id, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_creative_daily_campaign
  ON ads_creative_daily_metrics(campaign_pk, metric_date);

CREATE TABLE IF NOT EXISTS ads_segment_daily_metrics (
  campaign_pk                    INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  metric_date                    TEXT NOT NULL, -- YYYY-MM-DD
  provider_id                    TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_pk                     INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  segment_type                   TEXT NOT NULL, -- audience | placement | device | geography | other
  segment_value                  TEXT NOT NULL,
  impressions                    INTEGER NOT NULL DEFAULT 0,
  clicks                         INTEGER NOT NULL DEFAULT 0,
  spend_cents                    INTEGER NOT NULL DEFAULT 0,
  conversions                    INTEGER NOT NULL DEFAULT 0,
  conversion_value_cents         INTEGER NOT NULL DEFAULT 0,
  source_json                    TEXT,
  updated_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_pk, metric_date, segment_type, segment_value)
);

CREATE INDEX IF NOT EXISTS idx_ads_segment_daily_provider_date
  ON ads_segment_daily_metrics(provider_id, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_segment_daily_campaign
  ON ads_segment_daily_metrics(campaign_pk, metric_date);
