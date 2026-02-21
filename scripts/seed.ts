/**
 * Seed script — populates local D1 with warehouses and sample data
 * Run: npx tsx scripts/seed.ts
 */
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/lib/db/schema'

// For seeding, use the wrangler CLI to run SQL directly:
// npx wrangler d1 execute syncdash --local --file=drizzle/seed.sql

const SEED_SQL = `
-- Warehouses
INSERT OR IGNORE INTO warehouses (id, display_name, address, source_type, source_config, can_modify_stock, auto_sync, created_at) VALUES
  ('ireland',    'Entrepôt Irlande',  'Dublin, Ireland',   'shopify', '{"locationId": "SHOPIFY_TIKTOK_IRELAND_LOCATION_ID"}', 0, 1, datetime('now')),
  ('poland',     'Entrepôt Pologne',  'Warsaw, Poland',    'manual',  NULL,                                                    0, 0, datetime('now')),
  ('acer_store', 'ACER Store',        'France',            'scraper', '{"url": "ACER_STORE_URL"}',                             1, 0, datetime('now'));

-- Warehouse channel rules
INSERT OR IGNORE INTO warehouse_channel_rules (warehouse_id, platform, push_stock, push_status) VALUES
  ('ireland', 'woocommerce',        1, 0),
  ('ireland', 'shopify_komputerzz', 1, 0),
  ('ireland', 'shopify_tiktok',     0, 0),  -- TikTok auto-updates from warehouse
  ('poland',  'woocommerce',        1, 0),
  ('poland',  'shopify_komputerzz', 1, 0);
`

console.log('Seed SQL to run:')
console.log('npx wrangler d1 execute syncdash --local --command="' + SEED_SQL.replace(/\n/g, ' ').replace(/"/g, '\\"') + '"')
console.log()
console.log('Or save to drizzle/seed.sql and run:')
console.log('npx wrangler d1 execute syncdash --local --file=drizzle/seed.sql')
