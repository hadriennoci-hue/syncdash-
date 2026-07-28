-- 0042_seed_tiktok_category_ids.sql
-- TikTok Shop leaf category ids for the shopify_tiktok rows of channel_category_map.
-- Resolved live from the TikTok category tree (2113 cats) via the Open API, 2026-07-28.
-- cameras + accessories left NULL (no clean generic leaf; assign per-product if needed).
UPDATE channel_category_map SET tiktok_category_id='601756' WHERE platform='shopify_tiktok' AND taxonomy_key='laptops';
UPDATE channel_category_map SET tiktok_category_id='601756' WHERE platform='shopify_tiktok' AND taxonomy_key='gaming_laptops';
UPDATE channel_category_map SET tiktok_category_id='601756' WHERE platform='shopify_tiktok' AND taxonomy_key='work_laptops';
UPDATE channel_category_map SET tiktok_category_id='601836' WHERE platform='shopify_tiktok' AND taxonomy_key='desktops';
UPDATE channel_category_map SET tiktok_category_id='601836' WHERE platform='shopify_tiktok' AND taxonomy_key='ai_workstations';
UPDATE channel_category_map SET tiktok_category_id='601783' WHERE platform='shopify_tiktok' AND taxonomy_key='monitors';
UPDATE channel_category_map SET tiktok_category_id='601783' WHERE platform='shopify_tiktok' AND taxonomy_key='gaming_monitors';
UPDATE channel_category_map SET tiktok_category_id='601783' WHERE platform='shopify_tiktok' AND taxonomy_key='ultrawide_monitors';
UPDATE channel_category_map SET tiktok_category_id='601783' WHERE platform='shopify_tiktok' AND taxonomy_key='foldable_monitors';
UPDATE channel_category_map SET tiktok_category_id='601760' WHERE platform='shopify_tiktok' AND taxonomy_key='keyboards';
UPDATE channel_category_map SET tiktok_category_id='601760' WHERE platform='shopify_tiktok' AND taxonomy_key='mice';
UPDATE channel_category_map SET tiktok_category_id='601990' WHERE platform='shopify_tiktok' AND taxonomy_key='headsets_earbuds';
UPDATE channel_category_map SET tiktok_category_id='602029' WHERE platform='shopify_tiktok' AND taxonomy_key='audio';
UPDATE channel_category_map SET tiktok_category_id='601417' WHERE platform='shopify_tiktok' AND taxonomy_key='laptop_bags';
UPDATE channel_category_map SET tiktok_category_id='828808' WHERE platform='shopify_tiktok' AND taxonomy_key='docking_stations';
UPDATE channel_category_map SET tiktok_category_id='913928' WHERE platform='shopify_tiktok' AND taxonomy_key='controllers';
UPDATE channel_category_map SET tiktok_category_id='829320' WHERE platform='shopify_tiktok' AND taxonomy_key='connectivity';
UPDATE channel_category_map SET tiktok_category_id='827144' WHERE platform='shopify_tiktok' AND taxonomy_key='webcams';
UPDATE channel_category_map SET tiktok_category_id='825864' WHERE platform='shopify_tiktok' AND taxonomy_key='graphics_cards';
UPDATE channel_category_map SET tiktok_category_id='828296' WHERE platform='shopify_tiktok' AND taxonomy_key='storage';
UPDATE channel_category_map SET tiktok_category_id='825224' WHERE platform='shopify_tiktok' AND taxonomy_key='tablets';
UPDATE channel_category_map SET tiktok_category_id='912392' WHERE platform='shopify_tiktok' AND taxonomy_key='projectors';
UPDATE channel_category_map SET tiktok_category_id='913544' WHERE platform='shopify_tiktok' AND taxonomy_key='gaming_consoles';
UPDATE channel_category_map SET tiktok_category_id='876040' WHERE platform='shopify_tiktok' AND taxonomy_key='gaming_chairs';
UPDATE channel_category_map SET tiktok_category_id='875912' WHERE platform='shopify_tiktok' AND taxonomy_key='gaming_desks';
UPDATE channel_category_map SET tiktok_category_id='940040' WHERE platform='shopify_tiktok' AND taxonomy_key='electric_scooters';
