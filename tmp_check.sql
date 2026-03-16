SELECT
  COUNT(*) as total,
  SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) as has_description,
  SUM(CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END) as missing_description
FROM products;
