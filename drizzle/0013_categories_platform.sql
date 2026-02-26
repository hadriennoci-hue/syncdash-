-- Migration 13: Add platform to categories, rebuild category_mappings
-- categories.platform distinguishes shopify_komputerzz / shopify_tiktok / woocommerce collections
-- category_mappings now maps Shopify collections → WooCommerce categories (for fill-missing cross-fill)
--
-- NOTE: If running on a DB that already has the platform/description columns (local dev),
-- the ALTER TABLE statements will error. Run the UPDATE + DROP/CREATE parts manually in that case.

ALTER TABLE categories ADD COLUMN platform TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN description TEXT;

-- Backfill platform for any existing categories based on ID prefix
UPDATE categories SET platform = 'shopify_komputerzz' WHERE id LIKE 'shopify_komputerzz_%';
UPDATE categories SET platform = 'shopify_tiktok'     WHERE id LIKE 'shopify_tiktok_%';
UPDATE categories SET platform = 'woocommerce'        WHERE id LIKE 'woo_%';

DROP TABLE IF EXISTS category_mappings;

CREATE TABLE IF NOT EXISTS category_mappings (
  shopify_collection_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  woo_category_id       TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (shopify_collection_id, woo_category_id)
);
