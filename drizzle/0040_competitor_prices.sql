-- Migration 0040: competitor_prices table
-- Replaces the competitor namespace in product_metafields with a dedicated table
-- supporting up to 5 ranked competitor prices per product.

CREATE TABLE IF NOT EXISTS competitor_prices (
  id             TEXT    NOT NULL PRIMARY KEY,
  product_id     TEXT    NOT NULL REFERENCES products(id),
  rank           INTEGER NOT NULL,  -- 1 = cheapest, up to 5
  price          REAL    NOT NULL,
  url            TEXT,
  price_type     TEXT,              -- 'normal' | 'promo'
  competitor_name TEXT,
  updated_at     TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_prices_product_rank
  ON competitor_prices (product_id, rank);

-- Migrate existing rank-1 data from product_metafields
INSERT OR IGNORE INTO competitor_prices
  (id, product_id, rank, price, url, price_type, competitor_name, updated_at)
SELECT
  lower(hex(randomblob(16))),
  p.product_id,
  1,
  CAST(price_mf.value AS REAL),
  url_mf.value,
  pt_mf.value,
  NULL,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT product_id FROM product_metafields WHERE namespace = 'competitor') p
LEFT JOIN product_metafields price_mf
  ON price_mf.product_id = p.product_id AND price_mf.namespace = 'competitor' AND price_mf.key = 'price'
LEFT JOIN product_metafields url_mf
  ON url_mf.product_id = p.product_id AND url_mf.namespace = 'competitor' AND url_mf.key = 'url'
LEFT JOIN product_metafields pt_mf
  ON pt_mf.product_id = p.product_id AND pt_mf.namespace = 'competitor' AND pt_mf.key = 'price_type'
WHERE price_mf.value IS NOT NULL;
