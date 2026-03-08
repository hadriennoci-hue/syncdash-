-- Migration 20: Google Ads ingestion + order marketing attribution

CREATE TABLE IF NOT EXISTS raw_google_ads_campaigns (
  raw_pk              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         TEXT NOT NULL,
  campaign_id         TEXT NOT NULL,
  segments_date       TEXT,
  payload_json        TEXT NOT NULL,
  synced_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_google_ads_campaigns_snapshot
  ON raw_google_ads_campaigns(customer_id, campaign_id, segments_date);

CREATE TABLE IF NOT EXISTS raw_google_ads_ad_groups (
  raw_pk              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         TEXT NOT NULL,
  campaign_id         TEXT,
  ad_group_id         TEXT NOT NULL,
  segments_date       TEXT,
  payload_json        TEXT NOT NULL,
  synced_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_google_ads_ad_groups_snapshot
  ON raw_google_ads_ad_groups(customer_id, ad_group_id, segments_date);

CREATE TABLE IF NOT EXISTS raw_google_ads_click_views (
  raw_pk              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         TEXT NOT NULL,
  gclid               TEXT NOT NULL,
  campaign_id         TEXT,
  ad_group_id         TEXT,
  click_date_time     TEXT,
  segments_date       TEXT,
  payload_json        TEXT NOT NULL,
  synced_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_google_ads_click_views_snapshot
  ON raw_google_ads_click_views(customer_id, gclid, click_date_time);
CREATE INDEX IF NOT EXISTS idx_raw_google_ads_click_views_gclid
  ON raw_google_ads_click_views(gclid);

CREATE TABLE IF NOT EXISTS google_ads_campaigns (
  customer_id                 TEXT NOT NULL,
  campaign_id                 TEXT NOT NULL,
  name                        TEXT,
  status                      TEXT,
  advertising_channel_type    TEXT,
  start_date                  TEXT,
  end_date                    TEXT,
  currency_code               TEXT,
  budget_micros               INTEGER,
  last_synced_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS google_ads_ad_groups (
  customer_id                 TEXT NOT NULL,
  ad_group_id                 TEXT NOT NULL,
  campaign_id                 TEXT,
  name                        TEXT,
  status                      TEXT,
  type                        TEXT,
  cpc_bid_micros              INTEGER,
  last_synced_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, ad_group_id)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_ad_groups_campaign
  ON google_ads_ad_groups(customer_id, campaign_id);

CREATE TABLE IF NOT EXISTS sales_order_marketing (
  order_pk                    INTEGER PRIMARY KEY REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  landing_site                TEXT,
  referring_site              TEXT,
  utm_source                  TEXT,
  utm_medium                  TEXT,
  utm_campaign                TEXT,
  utm_term                    TEXT,
  utm_content                 TEXT,
  gclid                       TEXT,
  fbclid                      TEXT,
  ttclid                      TEXT,
  source_json                 TEXT,
  updated_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_order_marketing_gclid
  ON sales_order_marketing(gclid);
CREATE INDEX IF NOT EXISTS idx_sales_order_marketing_campaign
  ON sales_order_marketing(utm_campaign);

CREATE TABLE IF NOT EXISTS sales_order_attribution (
  order_pk                    INTEGER PRIMARY KEY REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  model                       TEXT NOT NULL, -- last_gclid_click | utm_campaign_name | unattributed
  confidence                  REAL,
  google_customer_id          TEXT,
  campaign_id                 TEXT,
  ad_group_id                 TEXT,
  gclid                       TEXT,
  click_time                  TEXT,
  notes                       TEXT,
  attributed_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_order_attribution_campaign
  ON sales_order_attribution(google_customer_id, campaign_id);

CREATE VIEW IF NOT EXISTS sales_marketing_consolidated AS
SELECT
  so.order_pk,
  so.channel_id,
  so.platform,
  so.external_order_id,
  so.external_order_name,
  so.order_created_at,
  so.currency_code,
  so.total_amount_cents,
  so.refunded_amount_cents,
  so.net_amount_cents,
  som.utm_source,
  som.utm_medium,
  som.utm_campaign,
  som.gclid,
  soa.model AS attribution_model,
  soa.confidence AS attribution_confidence,
  soa.google_customer_id,
  soa.campaign_id,
  gac.name AS campaign_name,
  soa.ad_group_id,
  gaa.name AS ad_group_name,
  soa.click_time,
  soa.attributed_at
FROM sales_orders so
LEFT JOIN sales_order_marketing som ON som.order_pk = so.order_pk
LEFT JOIN sales_order_attribution soa ON soa.order_pk = so.order_pk
LEFT JOIN google_ads_campaigns gac
  ON gac.customer_id = soa.google_customer_id
 AND gac.campaign_id = soa.campaign_id
LEFT JOIN google_ads_ad_groups gaa
  ON gaa.customer_id = soa.google_customer_id
 AND gaa.ad_group_id = soa.ad_group_id;
