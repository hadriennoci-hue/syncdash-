import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql, relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const suppliers = sqliteTable('suppliers', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  contactFirstName: text('contact_first_name'),
  contactLastName:  text('contact_last_name'),
  email:            text('email'),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const products = sqliteTable('products', {
  id:          text('id').primaryKey(), // SKU
  title:       text('title').notNull(),
  description: text('description'),
  status:      text('status').notNull().default('active'), // 'active' | 'archived'
  taxCode:              text('tax_code'),
  ean:                  text('ean'),                   // 13-digit EAN barcode
  commodityCode:        text('commodity_code'),        // HS customs tariff code
  customsDescription:   text('customs_description'),   // description for customs
  countryOfManufacture: text('country_of_manufacture'), // e.g. 'CN', 'DE'
  weight:               real('weight'),                // in kg
  weightUnit:           text('weight_unit').default('kg'),
  vendor:               text('vendor'),
  productType:          text('product_type'),
  isFeatured:           integer('is_featured').notNull().default(0),
  supplierId:           text('supplier_id').references(() => suppliers.id),
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
  recordType: text('record_type').notNull().default('product'), // 'product' | 'variant'
  variantId:  text('variant_id'),
  syncStatus: text('sync_status').notNull().default('pending'), // 'pending' | 'synced' | 'error'
  lastSynced: text('last_synced'),
}, (t) => ({ pk: primaryKey({ columns: [t.productId, t.platform] }) }))

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categories = sqliteTable('categories', {
  id:             text('id').primaryKey(),
  platform:       text('platform').notNull(),
  name:           text('name').notNull(),
  slug:           text('slug'),
  parentId:       text('parent_id'),
  description:    text('description'),
  collectionType: text('collection_type').notNull().default('product'),
  // 'product' | 'country_layout' | 'editorial'
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

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const warehouses = sqliteTable('warehouses', {
  id:             text('id').primaryKey(), // 'ireland' | 'poland' | 'acer_store' | 'spain'
  displayName:    text('display_name').notNull(),
  address:        text('address'),
  sourceType:     text('source_type').notNull(), // 'shopify' | 'scraping' | 'api_tbd' | 'manual'
  sourceConfig:   text('source_config'),         // JSON string
  canModifyStock: integer('can_modify_stock').notNull().default(0),
  autoSync:       integer('auto_sync').notNull().default(1),
  lastSynced:     text('last_synced'),
  createdAt:      text('created_at').default(sql`CURRENT_TIMESTAMP`),
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
  // 1 = primary source, 2 = secondary (fallback), etc.
  // No row for a (warehouse, platform) pair means the warehouse is FORBIDDEN for that channel.
  priority:    integer('priority').notNull().default(1),
}, (t) => ({ pk: primaryKey({ columns: [t.warehouseId, t.platform] }) }))

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = sqliteTable('orders', {
  id:             text('id').primaryKey(),
  invoiceNumber:  text('invoice_number').unique().notNull(),
  supplierId:     text('supplier_id').references(() => suppliers.id),
  warehouseId:    text('warehouse_id').references(() => warehouses.id),
  orderDate:      text('order_date').notNull(),
  paid:           integer('paid').notNull().default(0),
  sentToSupplier: integer('sent_to_supplier').notNull().default(0),
  arrivalStatus:  text('arrival_status').default('pending'),
  // 'pending' | 'arrived' | 'partial' | 'cancelled'
  createdAt:      text('created_at').default(sql`CURRENT_TIMESTAMP`),
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

// ---------------------------------------------------------------------------
// TikTok Selection
// ---------------------------------------------------------------------------

export const tiktokSelection = sqliteTable('tiktok_selection', {
  productId: text('product_id').primaryKey().references(() => products.id),
  addedAt:   text('added_at').default(sql`CURRENT_TIMESTAMP`),
})

// ---------------------------------------------------------------------------
// Automation & Health
// ---------------------------------------------------------------------------

export const apiHealthLog = sqliteTable('api_health_log', {
  id:              text('id').primaryKey(),
  checkedAt:       text('checked_at').notNull(),
  durationSeconds: real('duration_seconds'),
  results:         text('results').notNull(), // JSON string
  createdAt:       text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const dailySyncLog = sqliteTable('daily_sync_log', {
  id:               text('id').primaryKey(),
  syncedAt:         text('synced_at').notNull(),
  warehousesSynced: text('warehouses_synced'),  // JSON array string
  channelsPushed:   text('channels_pushed'),    // JSON array string
  ordersReconciled: integer('orders_reconciled').default(0),
  status:           text('status').notNull(),   // 'success' | 'partial' | 'error'
  message:          text('message'),
  createdAt:        text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

export const syncLog = sqliteTable('sync_log', {
  id:          text('id').primaryKey(),
  productId:   text('product_id'),
  platform:    text('platform'),
  action:      text('action').notNull(),
  status:      text('status').notNull(), // 'success' | 'error'
  message:     text('message'),
  triggeredBy: text('triggered_by').notNull().default('human'), // 'human' | 'agent' | 'system'
  createdAt:   text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const productsRelations = relations(products, ({ one, many }) => ({
  supplier:         one(suppliers, { fields: [products.supplierId], references: [suppliers.id] }),
  variants:         many(productVariants),
  images:           many(productImages),
  prices:           many(productPrices),
  metafields:       many(productMetafields),
  platformMappings: many(platformMappings),
  categories:       many(productCategories),
  warehouseStock:   many(warehouseStock),
  tiktokSelection:  one(tiktokSelection, { fields: [products.id], references: [tiktokSelection.productId] }),
}))

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}))

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}))

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
}))

export const platformMappingsRelations = relations(platformMappings, ({ one }) => ({
  product: one(products, { fields: [platformMappings.productId], references: [products.id] }),
}))

export const warehouseStockRelations = relations(warehouseStock, ({ one }) => ({
  product:   one(products,   { fields: [warehouseStock.productId],   references: [products.id] }),
  warehouse: one(warehouses, { fields: [warehouseStock.warehouseId], references: [warehouses.id] }),
}))

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  stock:        many(warehouseStock),
  channelRules: many(warehouseChannelRules),
  orders:       many(orders),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  supplier:  one(suppliers,  { fields: [orders.supplierId],  references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [orders.warehouseId], references: [warehouses.id] }),
  items:     many(orderItems),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order:   one(orders,   { fields: [orderItems.orderId],   references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}))

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  products: many(products),
  orders:   many(orders),
}))
