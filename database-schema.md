# Database Schema

> Cloudflare D1 (SQLite) — managed via Drizzle ORM

## Entity Relationship Diagram

```
┌──────────────────┐         ┌────────────────────────┐
│     products     │         │    platform_mappings    │
├──────────────────┤         ├────────────────────────┤
│ id (SKU) PK           │────┐    │ product_id FK          │
│ title                 │    └───►│ platform               │
│ description           │         │ platform_id            │
│ status                │         │ record_type            │
│ tax_code              │         │ variant_id             │
│ ean                   │         │ sync_status            │
│ commodity_code        │         │ last_synced            │
│ customs_description   │         └────────────────────────┘
│ country_of_manufacture│
│ weight / weight_unit  │
│ is_featured           │
│ supplier_id FK        │
│ vendor                │
│ product_type          │
│ created_at            │
│ updated_at            │
└──────────────────┘
        │ 1:N
        ├──────────────────────────────────────────────┐
        │                  │                           │
        ▼                  ▼                           ▼
┌──────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│product_images│  │  product_variants  │  │  product_metafields  │
└──────────────┘  └────────────────────┘  └──────────────────────┘

┌──────────────────┐    ┌──────────────────────┐
│    categories    │    │  product_categories  │
└──────────────────┘    └──────────────────────┘

┌─────────────────────┐    ┌──────────────────────┐
│   product_prices    │    │  tiktok_selection    │
└─────────────────────┘    └──────────────────────┘

┌──────────────────┐         ┌──────────────────────┐
│    suppliers     │         │   warehouse_stock    │
└──────────────────┘         └──────────────────────┘

┌──────────────────┐         ┌──────────────────────┐
│    warehouses    │         │       orders         │
└──────────────────┘         └──────────────────────┘

┌──────────────────┐         ┌──────────────────────┐
│   order_items    │         │   api_health_log     │
└──────────────────┘         └──────────────────────┘

┌──────────────────┐
│  daily_sync_log  │
└──────────────────┘

┌──────────────────────────────────┐
│           sync_log               │
└──────────────────────────────────┘
```

---

## Core Product Tables

### `products` — Master catalogue (SKU = primary key)
```sql
CREATE TABLE products (
  id           TEXT PRIMARY KEY,  -- SKU — shared key across all platforms
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  tax_code              TEXT,    -- VAT / tax category code
  ean                   TEXT,    -- 13-digit European Article Number (barcode)
  commodity_code        TEXT,    -- HS / customs tariff code (e.g. '8471.30.0000')
  customs_description   TEXT,    -- short description for customs declarations
  country_of_manufacture TEXT,   -- ISO country code, e.g. 'CN', 'DE'
  weight                REAL,    -- in kg (default unit)
  weight_unit           TEXT,    -- 'kg' | 'g' | 'lb' | 'oz' (default: 'kg')
  vendor                TEXT,    -- brand / manufacturer
  product_type          TEXT,    -- Shopify product type
  is_featured  INTEGER NOT NULL DEFAULT 0,  -- 0 | 1
  supplier_id  TEXT REFERENCES suppliers(id),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_products_featured ON products(is_featured);
```

**Localization:** Derived at query time from `categories` table — products with a `country_layout` category (FRA, ITA, POR, SPA, GER, UK, CHE, SWE) are considered localized. Not stored as a column.

### `product_variants` — Variants per product
```sql
CREATE TABLE product_variants (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title            TEXT,               -- ex: 'Black / 500GB', 'Red / XL'
  sku              TEXT,               -- variant-level SKU
  price            REAL,
  compare_at_price REAL,
  stock            INTEGER DEFAULT 0,
  available        INTEGER DEFAULT 1,  -- 0 | 1
  position         INTEGER DEFAULT 0,
  option1          TEXT,
  option2          TEXT,
  option3          TEXT,
  weight           REAL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_sku ON product_variants(sku);
```

### `product_images` — Images per product
```sql
CREATE TABLE product_images (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INTEGER DEFAULT 0,
  alt        TEXT,
  width      INTEGER,
  height     INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_images_product ON product_images(product_id);
```

### `product_prices` — Per-platform prices
```sql
CREATE TABLE product_prices (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL,
  -- 'woocommerce' | 'shopify_komputerzz' | 'shopify_tiktok' | ...
  price      REAL,
  compare_at REAL,   -- promo / strike-through price
  PRIMARY KEY (product_id, platform)
);
```

### `product_metafields` — Shopify metafields + attributes (imported from Komputerzz)
```sql
CREATE TABLE product_metafields (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  namespace  TEXT NOT NULL,  -- ex: 'custom', 'specifications', 'seo'
  key        TEXT NOT NULL,  -- ex: 'material', 'warranty_months', 'meta_title'
  value      TEXT,
  type       TEXT,
  -- 'single_line_text_field' | 'multi_line_text_field' | 'number_integer'
  -- 'number_decimal' | 'boolean' | 'json' | 'url' | 'date' | ...
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metafields_product ON product_metafields(product_id);
CREATE UNIQUE INDEX idx_metafields_key ON product_metafields(product_id, namespace, key);
```

### `platform_mappings` — Maps SKU to platform-native IDs
```sql
CREATE TABLE platform_mappings (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  platform_id TEXT NOT NULL,   -- native product ID on the platform
  record_type TEXT NOT NULL DEFAULT 'product',  -- 'product' | 'variant'
  variant_id  TEXT,            -- native variant ID (if record_type = 'variant')
  sync_status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'synced' | 'error'
  last_synced DATETIME,
  PRIMARY KEY (product_id, platform)
);

CREATE INDEX idx_mappings_platform ON platform_mappings(platform);
CREATE INDEX idx_mappings_platform_id ON platform_mappings(platform, platform_id);
```

---

## Category Tables

### `categories` — Shopify collections + WooCommerce categories
```sql
CREATE TABLE categories (
  id               TEXT PRIMARY KEY,
  platform         TEXT NOT NULL,
  -- 'shopify_komputerzz' | 'woocommerce' | 'shopify_tiktok'
  name             TEXT NOT NULL,
  slug             TEXT,
  parent_id        TEXT REFERENCES categories(id),
  description      TEXT,
  collection_type  TEXT NOT NULL DEFAULT 'product',
  -- 'product'        : main product category (Laptops, Desktops, Audio...)
  -- 'country_layout' : keyboard country layout (ita-qwerty, azerty, uk-qwerty...)
  --                    → marks product as localized (FRA, ITA, POR, SPA, GER, UK, CHE, SWE)
  -- 'editorial'      : featured/promo collections — ignored in mapping and validation
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_platform ON categories(platform);

CREATE TABLE product_categories (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);
```

### `category_mappings` — Shopify collection ↔ WooCommerce category (manual, one-time)
```sql
CREATE TABLE category_mappings (
  shopify_collection_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  woo_category_id       TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (shopify_collection_id, woo_category_id)
);

CREATE INDEX idx_catmap_shopify ON category_mappings(shopify_collection_id);
CREATE INDEX idx_catmap_woo ON category_mappings(woo_category_id);
```

---

## Supplier Tables

### `suppliers`
```sql
CREATE TABLE suppliers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,   -- ex: 'ACER'
  contact_first_name TEXT,
  contact_last_name  TEXT,
  email              TEXT,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Warehouse Tables

### `warehouses`
```sql
CREATE TABLE warehouses (
  id              TEXT PRIMARY KEY,
  -- 'ireland' | 'poland' | 'acer_store' | 'spain'
  display_name    TEXT NOT NULL,
  address         TEXT,
  source_type     TEXT NOT NULL,
  -- 'shopify'    : reads stock from a Shopify account (Ireland)
  -- 'scraping'   : scrapes a website (ACER Store)
  -- 'api_tbd'    : API not yet integrated (Poland)
  -- 'manual'     : manual entry only
  source_config   TEXT,
  -- JSON: { "shop": "xxx.myshopify.com", "token": "shpat_..." } for shopify
  -- JSON: { "url": "https://...", "selectors": {...} } for scraping
  can_modify_stock INTEGER NOT NULL DEFAULT 0,  -- 1 = Syncdash may write stock (ACER Store)
  auto_sync        INTEGER NOT NULL DEFAULT 1,  -- 1 = included in daily sync
  last_synced      DATETIME,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### `warehouse_stock` — Per-product stock snapshot per warehouse
```sql
CREATE TABLE warehouse_stock (
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id      TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity          INTEGER NOT NULL DEFAULT 0,
  quantity_ordered  INTEGER DEFAULT 0,   -- qty on open purchase orders
  last_order_date   DATETIME,            -- date of most recent purchase order
  purchase_price    REAL,                -- unit purchase price (HT)
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE INDEX idx_wstock_warehouse ON warehouse_stock(warehouse_id);
CREATE INDEX idx_wstock_product ON warehouse_stock(product_id);
```

### `warehouse_channel_rules` — Stock routing: which warehouses supply which channels and in what order
```sql
-- Rules:
--   Coincart (woocommerce):          Ireland (priority 1) + Acer Store (priority 2)
--   Komputerzz (shopify_komputerzz): Ireland (priority 1) + Acer Store (priority 2)
--   TikTok (shopify_tiktok):         Ireland (priority 1) ONLY — Acer Store FORBIDDEN (no row)
--
-- Missing row = warehouse is FORBIDDEN for that channel.
-- Stock pushed = SUM of quantities from all warehouses with a rule for that channel.
CREATE TABLE warehouse_channel_rules (
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,   -- 'woocommerce' | 'shopify_komputerzz' | 'shopify_tiktok' | ...
  priority     INTEGER NOT NULL DEFAULT 1,  -- 1 = primary, 2 = secondary/fallback
  PRIMARY KEY (warehouse_id, platform)
);
-- Example: spain warehouse → only shopify_tiktok = 1, all others = 0
```

---

## Order Tables

### `orders` — Purchase orders sent to suppliers
```sql
CREATE TABLE orders (
  id                 TEXT PRIMARY KEY,
  invoice_number     TEXT UNIQUE NOT NULL,
  supplier_id        TEXT REFERENCES suppliers(id),
  warehouse_id       TEXT REFERENCES warehouses(id),   -- delivery warehouse
  order_date         DATETIME NOT NULL,
  paid               INTEGER NOT NULL DEFAULT 0,        -- 0 | 1
  sent_to_supplier   INTEGER NOT NULL DEFAULT 0,        -- 0 | 1
  arrival_status     TEXT DEFAULT 'pending',
  -- 'pending' | 'arrived' | 'partial' | 'cancelled'
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_supplier ON orders(supplier_id);
CREATE INDEX idx_orders_warehouse ON orders(warehouse_id);
CREATE INDEX idx_orders_date ON orders(order_date DESC);
```

### `order_items` — Line items per order
```sql
CREATE TABLE order_items (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id),
  quantity           INTEGER NOT NULL,
  purchase_price     REAL NOT NULL,    -- unit price HT
  quantity_received  INTEGER DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
```

---

## Automation & Health Tables

### `api_health_log` — Daily API health check results
```sql
CREATE TABLE api_health_log (
  id               TEXT PRIMARY KEY,
  checked_at       DATETIME NOT NULL,
  duration_seconds REAL,    -- total duration of the full test suite
  results          TEXT NOT NULL,
  -- JSON: {
  --   "woocommerce": { "ok": true, "error": null, "latency_ms": 340 },
  --   "shopify_komputerzz": { "ok": true, "error": null, "latency_ms": 210 },
  --   "shopify_tiktok": { "ok": false, "error": "401 Unauthorized", "latency_ms": null }
  -- }
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_checked ON api_health_log(checked_at DESC);
```

### `daily_sync_log` — Daily warehouse sync + channel push results
```sql
CREATE TABLE daily_sync_log (
  id                TEXT PRIMARY KEY,
  synced_at         DATETIME NOT NULL,
  warehouses_synced TEXT,   -- JSON array: ["ireland", "acer_store"]
  channels_pushed   TEXT,   -- JSON array: ["woocommerce", "shopify_komputerzz"]
  orders_reconciled INTEGER DEFAULT 0,   -- number of orders updated
  status            TEXT NOT NULL,       -- 'success' | 'partial' | 'error'
  message           TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dsync_synced ON daily_sync_log(synced_at DESC);
```

---

## Audit Table

### `sync_log` — Full audit trail of all operations
```sql
CREATE TABLE sync_log (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id   TEXT,    -- NULL for platform-level or warehouse operations
  platform     TEXT,    -- NULL for multi-platform bulk operations
  action       TEXT NOT NULL,
  -- product:   'import' | 'create' | 'update_fields' | 'update_price'
  --            'set_images' | 'add_images' | 'delete_images' | 'copy_images'
  --            'toggle_status' | 'assign_categories' | 'delete'
  -- warehouse: 'sync_warehouse' | 'override_stock' | 'reconcile_order'
  -- system:    'api_health_check' | 'daily_sync'
  status       TEXT NOT NULL,   -- 'success' | 'error'
  message      TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'human',  -- 'human' | 'agent' | 'system'
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_log_product ON sync_log(product_id);
CREATE INDEX idx_log_created ON sync_log(created_at DESC);
CREATE INDEX idx_log_triggered_by ON sync_log(triggered_by);
```

---

## TikTok Selection

### `tiktok_selection` — The 30-40 products on TikTok Shop
```sql
CREATE TABLE tiktok_selection (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Drizzle Schema (TypeScript)

```typescript
// src/lib/db/schema.ts
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const suppliers = sqliteTable('suppliers', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  contactFirstName: text('contact_first_name'),
  contactLastName:  text('contact_last_name'),
  email:            text('email'),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const products = sqliteTable('products', {
  id:          text('id').primaryKey(),
  title:       text('title').notNull(),
  description: text('description'),
  status:      text('status').notNull().default('active'),
  taxCode:     text('tax_code'),
  weight:      real('weight'),
  weightUnit:  text('weight_unit'),
  vendor:      text('vendor'),
  productType: text('product_type'),
  isFeatured:  integer('is_featured').notNull().default(0),
  supplierId:  text('supplier_id').references(() => suppliers.id),
  createdAt:   text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt:   text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

export const productVariants = sqliteTable('product_variants', {
  id:             text('id').primaryKey(),
  productId:      text('product_id').notNull().references(() => products.id),
  title:          text('title'),
  sku:            text('sku'),
  price:          real('price'),
  compareAtPrice: real('compare_at_price'),
  stock:          integer('stock').default(0),
  available:      integer('available').default(1),
  position:       integer('position').default(0),
  option1:        text('option1'),
  option2:        text('option2'),
  option3:        text('option3'),
  weight:         real('weight'),
  createdAt:      text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const productImages = sqliteTable('product_images', {
  id:        text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  url:       text('url').notNull(),
  position:  integer('position').default(0),
  alt:       text('alt'),
  width:     integer('width'),
  height:    integer('height'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const productPrices = sqliteTable('product_prices', {
  productId: text('product_id').notNull().references(() => products.id),
  platform:  text('platform').notNull(),
  price:     real('price'),
  compareAt: real('compare_at'),
}, (t) => ({ pk: primaryKey({ columns: [t.productId, t.platform] }) }))

export const productMetafields = sqliteTable('product_metafields', {
  id:        text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  namespace: text('namespace').notNull(),
  key:       text('key').notNull(),
  value:     text('value'),
  type:      text('type'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const platformMappings = sqliteTable('platform_mappings', {
  productId:  text('product_id').notNull().references(() => products.id),
  platform:   text('platform').notNull(),
  platformId: text('platform_id').notNull(),
  recordType: text('record_type').notNull().default('product'),
  variantId:  text('variant_id'),
  syncStatus: text('sync_status').notNull().default('pending'),
  lastSynced: text('last_synced'),
}, (t) => ({ pk: primaryKey({ columns: [t.productId, t.platform] }) }))

export const categories = sqliteTable('categories', {
  id:             text('id').primaryKey(),
  platform:       text('platform').notNull(),
  name:           text('name').notNull(),
  slug:           text('slug'),
  parentId:       text('parent_id'),
  description:    text('description'),
  collectionType: text('collection_type').notNull().default('product'),
  createdAt:      text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const productCategories = sqliteTable('product_categories', {
  productId:  text('product_id').notNull().references(() => products.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
}, (t) => ({ pk: primaryKey({ columns: [t.productId, t.categoryId] }) }))

export const categoryMappings = sqliteTable('category_mappings', {
  shopifyCollectionId: text('shopify_collection_id').notNull().references(() => categories.id),
  wooCategoryId:       text('woo_category_id').notNull().references(() => categories.id),
}, (t) => ({ pk: primaryKey({ columns: [t.shopifyCollectionId, t.wooCategoryId] }) }))

export const warehouses = sqliteTable('warehouses', {
  id:               text('id').primaryKey(),
  displayName:      text('display_name').notNull(),
  address:          text('address'),
  sourceType:       text('source_type').notNull(),
  sourceConfig:     text('source_config'),  -- JSON string
  canModifyStock:   integer('can_modify_stock').notNull().default(0),
  autoSync:         integer('auto_sync').notNull().default(1),
  lastSynced:       text('last_synced'),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const warehouseStock = sqliteTable('warehouse_stock', {
  productId:       text('product_id').notNull().references(() => products.id),
  warehouseId:     text('warehouse_id').notNull().references(() => warehouses.id),
  quantity:        integer('quantity').notNull().default(0),
  quantityOrdered: integer('quantity_ordered').default(0),
  lastOrderDate:   text('last_order_date'),
  purchasePrice:   real('purchase_price'),
  updatedAt:       text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({ pk: primaryKey({ columns: [t.productId, t.warehouseId] }) }))

export const warehouseChannelRules = sqliteTable('warehouse_channel_rules', {
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  platform:    text('platform').notNull(),
  priority:    integer('priority').notNull().default(1),
}, (t) => ({ pk: primaryKey({ columns: [t.warehouseId, t.platform] }) }))

export const orders = sqliteTable('orders', {
  id:               text('id').primaryKey(),
  invoiceNumber:    text('invoice_number').unique().notNull(),
  supplierId:       text('supplier_id').references(() => suppliers.id),
  warehouseId:      text('warehouse_id').references(() => warehouses.id),
  orderDate:        text('order_date').notNull(),
  paid:             integer('paid').notNull().default(0),
  sentToSupplier:   integer('sent_to_supplier').notNull().default(0),
  arrivalStatus:    text('arrival_status').default('pending'),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const orderItems = sqliteTable('order_items', {
  id:               text('id').primaryKey(),
  orderId:          text('order_id').notNull().references(() => orders.id),
  productId:        text('product_id').notNull().references(() => products.id),
  quantity:         integer('quantity').notNull(),
  purchasePrice:    real('purchase_price').notNull(),
  quantityReceived: integer('quantity_received').default(0),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const apiHealthLog = sqliteTable('api_health_log', {
  id:              text('id').primaryKey(),
  checkedAt:       text('checked_at').notNull(),
  durationSeconds: real('duration_seconds'),
  results:         text('results').notNull(),  -- JSON string
  createdAt:       text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const dailySyncLog = sqliteTable('daily_sync_log', {
  id:                text('id').primaryKey(),
  syncedAt:          text('synced_at').notNull(),
  warehousesSynced:  text('warehouses_synced'),   -- JSON array string
  channelsPushed:    text('channels_pushed'),      -- JSON array string
  ordersReconciled:  integer('orders_reconciled').default(0),
  status:            text('status').notNull(),
  message:           text('message'),
  createdAt:         text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const syncLog = sqliteTable('sync_log', {
  id:          text('id').primaryKey(),
  productId:   text('product_id'),
  platform:    text('platform'),
  action:      text('action').notNull(),
  status:      text('status').notNull(),
  message:     text('message'),
  triggeredBy: text('triggered_by').notNull().default('human'),
  createdAt:   text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const tiktokSelection = sqliteTable('tiktok_selection', {
  productId: text('product_id').primaryKey().references(() => products.id),
  addedAt:   text('added_at').default(sql`CURRENT_TIMESTAMP`),
})
```

---

## Indexes Summary

| Table | Index | Purpose |
|-------|-------|---------|
| products | `idx_products_status` | Filter active/archived |
| products | `idx_products_supplier` | Products per supplier |
| products | `idx_products_featured` | Filter featured products |
| product_variants | `idx_variants_product` | All variants for a product |
| product_variants | `idx_variants_sku` | Find variant by SKU |
| product_images | `idx_images_product` | All images for a product |
| product_metafields | `idx_metafields_product` | All metafields for a product |
| platform_mappings | `idx_mappings_platform` | All products on a platform |
| platform_mappings | `idx_mappings_platform_id` | Find product by platform ID |
| categories | `idx_categories_platform` | Categories per platform |
| warehouse_stock | `idx_wstock_warehouse` | All stock for a warehouse |
| warehouse_stock | `idx_wstock_product` | All warehouse levels for a product |
| orders | `idx_orders_supplier` | Orders per supplier |
| orders | `idx_orders_warehouse` | Orders per warehouse |
| orders | `idx_orders_date` | Recent orders |
| order_items | `idx_order_items_order` | Items in an order |
| order_items | `idx_order_items_product` | Orders containing a product |
| sync_log | `idx_log_product` | History for a product |
| sync_log | `idx_log_created` | Recent operations |
| api_health_log | `idx_health_checked` | Most recent health check |
| daily_sync_log | `idx_dsync_synced` | Most recent daily sync |

---

## Migration Strategy

- Managed by `drizzle-kit`
- Migrations in `/drizzle/*.sql` — versioned in Git
- Run `npm run db:migrate` locally and via CI on deploy
- Never drop columns — add nullable columns and migrate data separately
- Never edit existing migration files — always create a new one

## Commands

```bash
npm run db:generate   # Generate migration from schema changes
npm run db:migrate    # Apply migrations to local D1 (via Wrangler)
npm run db:studio     # Open Drizzle Studio (visual DB browser)
npm run db:seed       # Seed with test data (dev only)
```
