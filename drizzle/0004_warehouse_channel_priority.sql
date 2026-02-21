-- Migration: replace push_stock/push_status with priority in warehouse_channel_rules
-- Run: npx wrangler d1 execute syncdash-db --local --file=./drizzle/0004_warehouse_channel_priority.sql

-- SQLite does not support DROP COLUMN or ALTER COLUMN in older versions.
-- Recreate the table with the new schema.

PRAGMA foreign_keys = OFF;

CREATE TABLE `warehouse_channel_rules_new` (
  `warehouse_id` TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  `platform`     TEXT NOT NULL,
  `priority`     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (`warehouse_id`, `platform`)
);

-- Migrate existing rows: rows with push_stock = 1 become priority 1
INSERT INTO `warehouse_channel_rules_new` (warehouse_id, platform, priority)
SELECT warehouse_id, platform, 1
FROM `warehouse_channel_rules`
WHERE push_stock = 1 OR allowed = 1;

DROP TABLE `warehouse_channel_rules`;
ALTER TABLE `warehouse_channel_rules_new` RENAME TO `warehouse_channel_rules`;

PRAGMA foreign_keys = ON;
