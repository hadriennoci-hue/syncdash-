PRAGMA foreign_keys = OFF;

-- Keep only collection namespaces we still use.
DELETE FROM product_categories
WHERE category_id IN (
  SELECT id
  FROM categories
  WHERE platform NOT IN ('shopify_tiktok', 'shopify_komputerzz')
);

DELETE FROM categories
WHERE platform NOT IN ('shopify_tiktok', 'shopify_komputerzz');

-- Remove keyboard layout collections entirely.
DELETE FROM product_categories
WHERE category_id IN (
  SELECT id
  FROM categories
  WHERE lower(coalesce(slug, name)) IN (
    'fra-azerty','ger-qwertz','ita-qwerty','spa-qwerty',
    'swe-qwerty','swiss-qwertz','uk-qwerty','us-qwerty'
  )
);

DELETE FROM categories
WHERE lower(coalesce(slug, name)) IN (
  'fra-azerty','ger-qwertz','ita-qwerty','spa-qwerty',
  'swe-qwerty','swiss-qwertz','uk-qwerty','us-qwerty'
);

-- Deduplicate TikTok collections by slug (case-insensitive): keep smallest ID per slug.
WITH tiktok_norm AS (
  SELECT id, lower(trim(slug)) AS nslug
  FROM categories
  WHERE platform = 'shopify_tiktok' AND slug IS NOT NULL AND trim(slug) <> ''
),
keepers AS (
  SELECT nslug, MIN(id) AS keep_id
  FROM tiktok_norm
  GROUP BY nslug
),
dupes AS (
  SELECT t.id AS dup_id, k.keep_id
  FROM tiktok_norm t
  JOIN keepers k ON k.nslug = t.nslug
  WHERE t.id <> k.keep_id
)
INSERT OR IGNORE INTO product_categories (product_id, category_id)
SELECT pc.product_id, d.keep_id
FROM product_categories pc
JOIN dupes d ON d.dup_id = pc.category_id;

WITH tiktok_norm AS (
  SELECT id, lower(trim(slug)) AS nslug
  FROM categories
  WHERE platform = 'shopify_tiktok' AND slug IS NOT NULL AND trim(slug) <> ''
),
keepers AS (
  SELECT nslug, MIN(id) AS keep_id
  FROM tiktok_norm
  GROUP BY nslug
),
dupes AS (
  SELECT t.id AS dup_id, k.keep_id
  FROM tiktok_norm t
  JOIN keepers k ON k.nslug = t.nslug
  WHERE t.id <> k.keep_id
)
DELETE FROM product_categories
WHERE category_id IN (SELECT dup_id FROM dupes);

WITH tiktok_norm AS (
  SELECT id, lower(trim(slug)) AS nslug
  FROM categories
  WHERE platform = 'shopify_tiktok' AND slug IS NOT NULL AND trim(slug) <> ''
),
keepers AS (
  SELECT nslug, MIN(id) AS keep_id
  FROM tiktok_norm
  GROUP BY nslug
),
dupes AS (
  SELECT t.id AS dup_id, k.keep_id
  FROM tiktok_norm t
  JOIN keepers k ON k.nslug = t.nslug
  WHERE t.id <> k.keep_id
)
DELETE FROM categories
WHERE id IN (SELECT dup_id FROM dupes);

PRAGMA foreign_keys = ON;
