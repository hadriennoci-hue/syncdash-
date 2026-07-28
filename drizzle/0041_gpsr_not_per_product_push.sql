-- 0041_gpsr_not_per_product_push.sql
-- GPSR (manufacturer + EU responsible person) is registered ONCE in TikTok Seller Center and
-- referenced by ID — it is supplier-constant and not materialised in the per-product Shopify push.
-- So mark it not-pushed but still required for the readiness gate (the supplier block must be filled
-- and registered before listing). See docs/tiktok-readiness-spec.md §4 / verify-at-connect §7.
UPDATE channel_field_rules
   SET pushed = 0,
       notes  = 'registered once in TikTok Seller Center by ID; supplier-level, not a per-product push'
 WHERE platform = 'shopify_tiktok' AND field_key = 'gpsr';
