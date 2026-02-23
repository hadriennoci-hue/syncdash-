-- Migration: add EAN + customs fields to products
-- Run against an existing DB: npm run db:migrate2
-- (or: npx wrangler d1 execute syncdash-db --local --file=./drizzle/0002_product_customs_fields.sql)

-- Columns already included in 0001_init.sql for fresh installs.
-- This migration only needed for databases created before these columns were added.
-- Index on EAN for fast barcode lookups
CREATE INDEX IF NOT EXISTS `idx_products_ean` ON `products` (`ean`);
