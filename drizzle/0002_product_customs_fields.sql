-- Migration: add EAN + customs fields to products
-- Run against an existing DB: npm run db:migrate2
-- (or: npx wrangler d1 execute syncdash-db --local --file=./drizzle/0002_product_customs_fields.sql)

ALTER TABLE `products` ADD COLUMN `ean`                    TEXT;
ALTER TABLE `products` ADD COLUMN `commodity_code`         TEXT;
ALTER TABLE `products` ADD COLUMN `customs_description`    TEXT;
ALTER TABLE `products` ADD COLUMN `country_of_manufacture` TEXT;

-- Index on EAN for fast barcode lookups
CREATE INDEX IF NOT EXISTS `idx_products_ean` ON `products` (`ean`);
