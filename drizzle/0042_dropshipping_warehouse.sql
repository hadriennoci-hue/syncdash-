-- Manual Dropshipping warehouse. It is displayed in stock views but skipped by
-- automated warehouse scan/fill flows.
INSERT OR IGNORE INTO warehouses (id, display_name, address, source_type, source_config, can_modify_stock, auto_sync, created_at) VALUES
  ('dropshipping', 'Dropshipping', NULL, 'manual', NULL, 0, 0, datetime('now'));

INSERT OR IGNORE INTO warehouse_channel_rules (warehouse_id, platform, priority) VALUES
  ('dropshipping', 'coincart2',          3),
  ('dropshipping', 'shopify_komputerzz', 3),
  ('dropshipping', 'ebay_ie',            3);
