PRAGMA foreign_keys = OFF;

ALTER TABLE products RENAME COLUMN pushed_woocommerce TO pushed_coincart2;

UPDATE platform_mappings
SET platform = 'coincart2'
WHERE platform = 'woocommerce';

UPDATE product_prices
SET platform = 'coincart2'
WHERE platform = 'woocommerce';

UPDATE warehouse_channel_rules
SET platform = 'coincart2'
WHERE platform = 'woocommerce';

UPDATE sales_channels
SET id = 'coincart2'
WHERE id = 'woocommerce';

UPDATE sync_log
SET platform = 'coincart2'
WHERE platform = 'woocommerce';

DELETE FROM product_categories
WHERE category_id IN (
  SELECT id FROM categories WHERE platform IN ('woocommerce', 'coincart2')
);

DELETE FROM categories
WHERE platform IN ('woocommerce', 'coincart2');

DROP TABLE IF EXISTS category_mappings;

PRAGMA foreign_keys = ON;
