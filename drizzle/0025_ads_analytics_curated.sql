-- Migration 25: Ads + Shopify consolidated analytics (curated KPIs)

CREATE TABLE IF NOT EXISTS ads_campaign_daily_metrics (
  campaign_pk                    INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  metric_date                    TEXT NOT NULL, -- YYYY-MM-DD
  provider_id                    TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_pk                     INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  impressions                    INTEGER NOT NULL DEFAULT 0,
  clicks                         INTEGER NOT NULL DEFAULT 0,
  spend_cents                    INTEGER NOT NULL DEFAULT 0,
  conversions                    INTEGER NOT NULL DEFAULT 0,
  conversion_value_cents         INTEGER NOT NULL DEFAULT 0,
  source_json                    TEXT,
  updated_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_pk, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_ads_campaign_daily_provider_date
  ON ads_campaign_daily_metrics(provider_id, metric_date);

CREATE TABLE IF NOT EXISTS shopify_sku_daily_metrics (
  metric_date                    TEXT NOT NULL, -- YYYY-MM-DD
  channel_id                     TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  product_sku                    TEXT NOT NULL,
  orders_count                   INTEGER NOT NULL DEFAULT 0,
  units_sold                     INTEGER NOT NULL DEFAULT 0,
  gross_revenue_cents            INTEGER NOT NULL DEFAULT 0,
  refunded_cents                 INTEGER NOT NULL DEFAULT 0,
  net_revenue_cents              INTEGER NOT NULL DEFAULT 0,
  source_json                    TEXT,
  updated_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_date, channel_id, product_sku)
);

CREATE INDEX IF NOT EXISTS idx_shopify_sku_daily_sku_date
  ON shopify_sku_daily_metrics(product_sku, metric_date);

CREATE TABLE IF NOT EXISTS ads_campaign_kpi_daily (
  campaign_pk                    INTEGER NOT NULL REFERENCES ads_campaigns(campaign_pk) ON DELETE CASCADE,
  metric_date                    TEXT NOT NULL, -- YYYY-MM-DD
  provider_id                    TEXT NOT NULL REFERENCES ads_providers(provider_id) ON DELETE CASCADE,
  account_pk                     INTEGER NOT NULL REFERENCES ads_accounts(account_pk) ON DELETE CASCADE,
  product_sku                    TEXT NOT NULL,
  spend_cents                    INTEGER NOT NULL DEFAULT 0,
  clicks                         INTEGER NOT NULL DEFAULT 0,
  impressions                    INTEGER NOT NULL DEFAULT 0,
  provider_conversions           INTEGER NOT NULL DEFAULT 0,
  provider_conversion_value_cents INTEGER NOT NULL DEFAULT 0,
  shopify_orders                 INTEGER NOT NULL DEFAULT 0,
  shopify_units                  INTEGER NOT NULL DEFAULT 0,
  shopify_net_revenue_cents      INTEGER NOT NULL DEFAULT 0,
  roas                           REAL,
  cpa_cents                      INTEGER,
  ctr                            REAL,
  cpc_cents                      INTEGER,
  attribution_model              TEXT NOT NULL DEFAULT 'sku_time_window_proxy',
  attribution_confidence         REAL NOT NULL DEFAULT 0.35,
  updated_at                     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_pk, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_ads_campaign_kpi_daily_provider_date
  ON ads_campaign_kpi_daily(provider_id, metric_date);
