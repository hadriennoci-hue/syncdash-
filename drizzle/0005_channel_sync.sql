-- Add source URL + name to warehouse_stock (populated by ACER scraper)
ALTER TABLE warehouse_stock ADD COLUMN source_url TEXT;
ALTER TABLE warehouse_stock ADD COLUMN source_name TEXT;

-- Flag for new products auto-created during channel sync (needs user review)
ALTER TABLE products ADD COLUMN pending_review INTEGER NOT NULL DEFAULT 0;
