-- Add created_at column to product_metafields (was missing from 0001_init.sql)
ALTER TABLE product_metafields ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
