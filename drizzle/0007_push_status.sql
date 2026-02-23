-- Push status per channel on each product
-- N = do not push, 2push = push on next Update Products run, done = already pushed
ALTER TABLE products ADD COLUMN pushed_woocommerce        TEXT NOT NULL DEFAULT 'N';
ALTER TABLE products ADD COLUMN pushed_shopify_komputerzz TEXT NOT NULL DEFAULT 'N';
ALTER TABLE products ADD COLUMN pushed_shopify_tiktok     TEXT NOT NULL DEFAULT 'N';

-- Backfill: products that already have a platform mapping are already pushed
UPDATE products SET pushed_woocommerce        = 'done'
  WHERE id IN (SELECT product_id FROM platform_mappings WHERE platform = 'woocommerce');
UPDATE products SET pushed_shopify_komputerzz = 'done'
  WHERE id IN (SELECT product_id FROM platform_mappings WHERE platform = 'shopify_komputerzz');
UPDATE products SET pushed_shopify_tiktok     = 'done'
  WHERE id IN (SELECT product_id FROM platform_mappings WHERE platform = 'shopify_tiktok');
