-- 0038_seed_channel_category_map.sql
-- Seed taxonomy_key -> Shopify standard category GID for shopify_tiktok
-- (docs/tiktok-readiness-spec.md §2.3). Fixes Shopify's title-based auto-guess, which
-- mislabelled the dock as "Notebooks & Notepads" and the earbuds as "Mice & Trackballs".
--
-- Only shopify_tiktok is seeded: shopify_komputerzz intentionally has NO rows, so it keeps
-- its current behaviour (category resolves to the root 'el'), unchanged.
-- tiktok_category_id + required_attribute_keys are filled once TikTok Shop is connected.
-- GIDs verified 2026-07-28 against the Tech Store Shopify taxonomy.
DELETE FROM channel_category_map WHERE platform = 'shopify_tiktok';
INSERT INTO channel_category_map (taxonomy_key, platform, shopify_category_gid, tiktok_category_id, required_attribute_keys) VALUES
  ('mouse',           'shopify_tiktok', 'gid://shopify/TaxonomyCategory/el-7-9-12-11',  NULL, NULL),  -- Mice & Trackballs
  ('earbuds',         'shopify_tiktok', 'gid://shopify/TaxonomyCategory/el-2-2-7-1-3',  NULL, NULL),  -- In-Ear Headphones
  ('backpack',        'shopify_tiktok', 'gid://shopify/TaxonomyCategory/lb-1-16',       NULL, NULL),  -- Laptop Backpacks
  ('docking_station', 'shopify_tiktok', 'gid://shopify/TaxonomyCategory/el-7-8-7',      NULL, NULL),  -- Laptop Docking Stations
  ('game_controller', 'shopify_tiktok', 'gid://shopify/TaxonomyCategory/el-7-9-12-5-3', NULL, NULL),  -- Gaming Pads
  ('router',          'shopify_tiktok', 'gid://shopify/TaxonomyCategory/el-12-1-4',     NULL, NULL);   -- Wireless Routers
