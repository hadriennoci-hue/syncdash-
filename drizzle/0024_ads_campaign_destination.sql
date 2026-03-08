-- Migration 24: enforce explicit product destination for ad campaigns

ALTER TABLE ads_campaigns ADD COLUMN destination_type TEXT;
ALTER TABLE ads_campaigns ADD COLUMN product_sku TEXT;
ALTER TABLE ads_campaigns ADD COLUMN destination_url TEXT;
ALTER TABLE ads_campaigns ADD COLUMN destination_pending INTEGER NOT NULL DEFAULT 0;
