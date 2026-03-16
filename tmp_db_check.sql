SELECT
  (SELECT COUNT(*) FROM products) as total,
  (SELECT COUNT(*) FROM products WHERE description IS NOT NULL AND description != '') as has_description,
  (SELECT COUNT(*) FROM products WHERE description IS NULL OR description = '') as missing_description,
  (SELECT COUNT(DISTINCT product_id) FROM product_metafields WHERE namespace='attributes') as has_attributes;
