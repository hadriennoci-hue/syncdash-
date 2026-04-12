-- SyncDash seed data
-- Run: npx wrangler d1 execute syncdash --local --file=drizzle/seed.sql

-- Suppliers
INSERT OR IGNORE INTO suppliers (id, name) VALUES
  ('acer', 'ACER');

-- Warehouses
INSERT OR IGNORE INTO warehouses (id, display_name, address, source_type, source_config, can_modify_stock, auto_sync, created_at) VALUES
  ('ireland',    'Entrepôt Irlande',  'Dublin, Ireland', 'shopify', '{"locationId":"placeholder"}', 0, 1, datetime('now')),
  ('poland',     'Entrepôt Pologne',  'Warsaw, Poland',  'manual',   NULL,                           0, 0, datetime('now')),
  ('acer_store', 'ACER Store',        'France',          'scraper', '{"url":"placeholder"}',         0, 0, datetime('now')),
  ('dropshipping', 'Dropshipping',    NULL,              'manual',   NULL,                           0, 0, datetime('now'));

-- Sales Channels
INSERT OR IGNORE INTO sales_channels (id, name, url, connector_type, enabled, config, created_at) VALUES
  ('coincart2',        'CoInCart',            'https://coincart.store',   'woocommerce_api', 1, NULL,                                                                                                                    datetime('now')),
  ('shopify_komputerzz', 'Komputerzz',          'https://komputerzz.com',   'shopify_api',     1, '{"shopDomain":"ikw70s-fr.myshopify.com"}',                                                                              datetime('now')),
  ('shopify_tiktok',     'Tech Store (TikTok)', 'https://shop.tiktok.com',  'shopify_api',     1, '{"shopDomain":"qanjg5-0h.myshopify.com"}',                                                                              datetime('now')),
  ('ebay_ie',            'eBay Ireland',        'https://www.ebay.ie',      'ebay_api',        1, '{"marketplaceId":"EBAY_IE","format":"FIXED_PRICE"}',                                                                    datetime('now')),
  ('libre_market',       'Libre Market',        'https://libre-market.com', 'browser',         1, '{"loginUrl":"https://libre-market.com/merchant/signin","newListingUrl":null}',                                          datetime('now')),
  ('xmr_bazaar',         'XMR Bazaar',          'https://xmrbazaar.com',    'browser',         1, '{"loginUrl":"https://xmrbazaar.com/login/","newListingUrl":"https://xmrbazaar.com/new-listing/"}',                      datetime('now'));

-- Warehouse → channel routing rules
-- priority 1 = primary stock source, 2 = secondary/fallback
-- No row = warehouse FORBIDDEN for that channel
--
-- Rules:
--   Coincart (coincart2):       Ireland (1st) + Acer Store (2nd)
--   Komputerzz (shopify_komputerzz): Ireland (1st) + Acer Store (2nd)
--   TikTok (shopify_tiktok):      Ireland ONLY — Acer Store is FORBIDDEN (no row)
INSERT OR IGNORE INTO warehouse_channel_rules (warehouse_id, platform, priority) VALUES
  ('ireland',    'coincart2',        1),
  ('acer_store', 'coincart2',        2),
  ('dropshipping', 'coincart2',      3),
  ('ireland',    'shopify_komputerzz', 1),
  ('acer_store', 'shopify_komputerzz', 2),
  ('dropshipping', 'shopify_komputerzz', 3),
  ('ireland',    'ebay_ie',            1),
  ('acer_store', 'ebay_ie',            2),
  ('dropshipping', 'ebay_ie',          3),
  ('ireland',    'shopify_tiktok',     1);
  -- acer_store + shopify_tiktok: intentionally omitted = FORBIDDEN

