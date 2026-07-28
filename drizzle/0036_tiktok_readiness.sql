-- 0036_tiktok_readiness.sql
-- Additive TikTok-readiness schema (see docs/tiktok-readiness-spec.md).
-- All new columns are nullable; no data changes; safe to run once per environment.

-- suppliers: GPSR compliance block (inherited by that supplier's products)
ALTER TABLE suppliers ADD COLUMN manufacturer_name TEXT;
ALTER TABLE suppliers ADD COLUMN manufacturer_address TEXT;
ALTER TABLE suppliers ADD COLUMN manufacturer_email TEXT;
ALTER TABLE suppliers ADD COLUMN eu_rp_name TEXT;
ALTER TABLE suppliers ADD COLUMN eu_rp_address TEXT;
ALTER TABLE suppliers ADD COLUMN eu_rp_email TEXT;
ALTER TABLE suppliers ADD COLUMN default_country_of_origin TEXT;

-- products: category resolution + shipping + commerce fields
ALTER TABLE products ADD COLUMN taxonomy_key TEXT;
ALTER TABLE products ADD COLUMN shopify_category_gid TEXT;
ALTER TABLE products ADD COLUMN tiktok_category_id TEXT;
ALTER TABLE products ADD COLUMN package_length_mm INTEGER;
ALTER TABLE products ADD COLUMN package_width_mm INTEGER;
ALTER TABLE products ADD COLUMN package_height_mm INTEGER;
ALTER TABLE products ADD COLUMN package_weight_g INTEGER;
ALTER TABLE products ADD COLUMN warranty_months INTEGER;
ALTER TABLE products ADD COLUMN box_contents TEXT;

-- product_images: TikTok image-compliance rating
ALTER TABLE product_images ADD COLUMN tiktok_status TEXT;
ALTER TABLE product_images ADD COLUMN tiktok_issues TEXT;
ALTER TABLE product_images ADD COLUMN rated_at TEXT;

-- category map: internal taxonomy_key -> per-channel category
CREATE TABLE IF NOT EXISTS channel_category_map (
  taxonomy_key            TEXT NOT NULL,
  platform                TEXT NOT NULL,
  shopify_category_gid    TEXT,
  tiktok_category_id      TEXT,
  required_attribute_keys TEXT,
  PRIMARY KEY (taxonomy_key, platform)
);

-- per-channel field rules: which fields are pushed/required per sales channel
CREATE TABLE IF NOT EXISTS channel_field_rules (
  platform  TEXT NOT NULL,
  field_key TEXT NOT NULL,
  pushed    INTEGER NOT NULL DEFAULT 1,
  required  INTEGER NOT NULL DEFAULT 0,
  notes     TEXT,
  PRIMARY KEY (platform, field_key)
);
