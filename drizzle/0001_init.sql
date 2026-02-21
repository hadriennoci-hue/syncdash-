-- SyncDash initial migration
-- Generated for Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`         TEXT PRIMARY KEY NOT NULL,
  `name`       TEXT NOT NULL,
  `contact`    TEXT,
  `email`      TEXT,
  `phone`      TEXT,
  `notes`      TEXT,
  `created_at` TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `products` (
  `id`           TEXT PRIMARY KEY NOT NULL,  -- SKU
  `title`        TEXT NOT NULL,
  `description`  TEXT,
  `status`       TEXT NOT NULL DEFAULT 'active',
  `tax_code`              TEXT,
  `ean`                   TEXT,
  `commodity_code`        TEXT,
  `customs_description`   TEXT,
  `country_of_manufacture` TEXT,
  `weight`                REAL,
  `weight_unit`           TEXT DEFAULT 'kg',
  `vendor`                TEXT,
  `product_type` TEXT,
  `is_featured`  INTEGER NOT NULL DEFAULT 0,
  `supplier_id`  TEXT REFERENCES suppliers(id),
  `created_at`   TEXT NOT NULL,
  `updated_at`   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `product_variants` (
  `id`          TEXT PRIMARY KEY NOT NULL,
  `product_id`  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `title`       TEXT,
  `sku`         TEXT,
  `price`       REAL,
  `compare_at`  REAL,
  `stock`       INTEGER DEFAULT 0,
  `option1`     TEXT,
  `option2`     TEXT,
  `option3`     TEXT,
  `created_at`  TEXT NOT NULL,
  `updated_at`  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `product_images` (
  `id`         TEXT PRIMARY KEY NOT NULL,
  `product_id` TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `url`        TEXT NOT NULL,
  `alt`        TEXT,
  `position`   INTEGER NOT NULL DEFAULT 0,
  `created_at` TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `product_prices` (
  `product_id`  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `platform`    TEXT NOT NULL,
  `price`       REAL,
  `compare_at`  REAL,
  `updated_at`  TEXT NOT NULL,
  PRIMARY KEY (`product_id`, `platform`)
);

CREATE TABLE IF NOT EXISTS `product_metafields` (
  `id`         TEXT PRIMARY KEY NOT NULL,
  `product_id` TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `namespace`  TEXT NOT NULL,
  `key`        TEXT NOT NULL,
  `value`      TEXT NOT NULL,
  `type`       TEXT NOT NULL DEFAULT 'single_line_text_field'
);

CREATE TABLE IF NOT EXISTS `platform_mappings` (
  `product_id`  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `platform`    TEXT NOT NULL,
  `platform_id` TEXT NOT NULL,
  `record_type` TEXT NOT NULL DEFAULT 'product',
  `sync_status` TEXT NOT NULL DEFAULT 'synced',
  `updated_at`  TEXT NOT NULL,
  PRIMARY KEY (`product_id`, `platform`)
);

CREATE TABLE IF NOT EXISTS `categories` (
  `id`              TEXT PRIMARY KEY NOT NULL,
  `name`            TEXT NOT NULL,
  `slug`            TEXT NOT NULL,
  `collection_type` TEXT NOT NULL DEFAULT 'product',
  `parent_id`       TEXT REFERENCES categories(id),
  `created_at`      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `product_categories` (
  `product_id`  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `category_id` TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (`product_id`, `category_id`)
);

CREATE TABLE IF NOT EXISTS `category_mappings` (
  `category_id` TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  `platform`    TEXT NOT NULL,
  `platform_id` TEXT NOT NULL,
  PRIMARY KEY (`category_id`, `platform`)
);

CREATE TABLE IF NOT EXISTS `warehouses` (
  `id`              TEXT PRIMARY KEY NOT NULL,
  `display_name`    TEXT NOT NULL,
  `address`         TEXT,
  `source_type`     TEXT NOT NULL DEFAULT 'manual',
  `source_config`   TEXT,
  `can_modify_stock` INTEGER NOT NULL DEFAULT 0,
  `auto_sync`       INTEGER NOT NULL DEFAULT 0,
  `last_synced`     TEXT,
  `created_at`      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `warehouse_stock` (
  `product_id`       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `warehouse_id`     TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  `quantity`         INTEGER NOT NULL DEFAULT 0,
  `quantity_ordered` INTEGER DEFAULT 0,
  `last_order_date`  TEXT,
  `purchase_price`   REAL,
  `updated_at`       TEXT NOT NULL,
  PRIMARY KEY (`product_id`, `warehouse_id`)
);

CREATE TABLE IF NOT EXISTS `warehouse_channel_rules` (
  `warehouse_id` TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  `platform`     TEXT NOT NULL,
  -- 1 = primary stock source, 2 = secondary/fallback, etc.
  -- No row for a (warehouse, platform) pair = that warehouse is FORBIDDEN for that channel.
  `priority`     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (`warehouse_id`, `platform`)
);

CREATE TABLE IF NOT EXISTS `orders` (
  `id`             TEXT PRIMARY KEY NOT NULL,
  `invoice_number` TEXT,
  `supplier_id`    TEXT REFERENCES suppliers(id),
  `warehouse_id`   TEXT NOT NULL REFERENCES warehouses(id),
  `order_date`     TEXT NOT NULL,
  `paid`           INTEGER NOT NULL DEFAULT 0,
  `sent_to_supplier` INTEGER NOT NULL DEFAULT 0,
  `arrival_status` TEXT NOT NULL DEFAULT 'pending',
  `created_at`     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `order_items` (
  `id`                TEXT PRIMARY KEY NOT NULL,
  `order_id`          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  `product_id`        TEXT NOT NULL REFERENCES products(id),
  `quantity`          INTEGER NOT NULL,
  `purchase_price`    REAL,
  `quantity_received` INTEGER DEFAULT 0,
  `created_at`        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `sync_log` (
  `id`           TEXT PRIMARY KEY NOT NULL,
  `product_id`   TEXT,
  `platform`     TEXT,
  `action`       TEXT NOT NULL,
  `status`       TEXT NOT NULL,
  `message`      TEXT,
  `triggered_by` TEXT NOT NULL DEFAULT 'human',
  `created_at`   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `api_health_log` (
  `id`               TEXT PRIMARY KEY NOT NULL,
  `checked_at`       TEXT NOT NULL,
  `duration_seconds` REAL,
  `results`          TEXT NOT NULL,
  `created_at`       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `daily_sync_log` (
  `id`                TEXT PRIMARY KEY NOT NULL,
  `synced_at`         TEXT NOT NULL,
  `warehouses_synced` TEXT NOT NULL DEFAULT '[]',
  `channels_pushed`   TEXT NOT NULL DEFAULT '[]',
  `orders_reconciled` INTEGER NOT NULL DEFAULT 0,
  `status`            TEXT NOT NULL DEFAULT 'success',
  `message`           TEXT,
  `created_at`        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS `tiktok_selection` (
  `product_id` TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  `added_at`   TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS `idx_products_status`       ON `products` (`status`);
CREATE INDEX IF NOT EXISTS `idx_products_supplier`     ON `products` (`supplier_id`);
CREATE INDEX IF NOT EXISTS `idx_variants_product`      ON `product_variants` (`product_id`);
CREATE INDEX IF NOT EXISTS `idx_images_product`        ON `product_images` (`product_id`, `position`);
CREATE INDEX IF NOT EXISTS `idx_prices_platform`       ON `product_prices` (`platform`);
CREATE INDEX IF NOT EXISTS `idx_mappings_platform`     ON `platform_mappings` (`platform`);
CREATE INDEX IF NOT EXISTS `idx_stock_warehouse`       ON `warehouse_stock` (`warehouse_id`);
CREATE INDEX IF NOT EXISTS `idx_orders_warehouse`      ON `orders` (`warehouse_id`);
CREATE INDEX IF NOT EXISTS `idx_orders_supplier`       ON `orders` (`supplier_id`);
CREATE INDEX IF NOT EXISTS `idx_sync_log_product`      ON `sync_log` (`product_id`);
CREATE INDEX IF NOT EXISTS `idx_sync_log_created`      ON `sync_log` (`created_at`);
CREATE INDEX IF NOT EXISTS `idx_health_checked`        ON `api_health_log` (`checked_at`);
CREATE INDEX IF NOT EXISTS `idx_daily_sync_synced`     ON `daily_sync_log` (`synced_at`);
