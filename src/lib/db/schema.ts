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
  id:               text('id').primaryKey(), // SKU
  title:            text('title').notNull(),
  description:      text('description'),
  tags:             text('tags'), // JSON array string (up to 10 one-word tags)
  status:           text('status').notNull().default('active'), // 'active' | 'archived'
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
  pendingReview:        integer('pending_review').notNull().default(0), // 1 = auto-created, needs user check
  supplierId:           text('supplier_id').references(() => suppliers.id),
  // Push status per channel: 'N' = don't push, '2push' = push on next run, 'done' = already pushed
  pushedWoocommerce:        text('pushed_woocommerce').notNull().default('N'),
  pushedShopifyKomputerzz:  text('pushed_shopify_komputerzz').notNull().default('N'),
  pushedShopifyTiktok:      text('pushed_shopify_tiktok').notNull().default('N'),
  pushedEbayIe:             text('pushed_ebay_ie').notNull().default('N'),
  pushedXmrBazaar:          text('pushed_xmr_bazaar').notNull().default('N'),
  pushedLibreMarket:        text('pushed_libre_market').notNull().default('N'),
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
  updatedAt: text('updated_at').notNull(),
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
  updatedAt:  text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
  purchasePrice:   real('purchase_price'),   // actual cost price — manual entry only
  importPrice:     real('import_price'),     // listed price scraped from source (e.g. ACER Store)
  importPromoPrice: real('import_promo_price'), // promo/discounted price scraped from source
  sourceUrl:       text('source_url'),   // product page URL on the source site (e.g. ACER Store)
  sourceName:      text('source_name'),  // product name as scraped from source
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
// Sales Channels
// ---------------------------------------------------------------------------

export const salesChannels = sqliteTable('sales_channels', {
  id:            text('id').primaryKey(),            // matches Platform type: 'woocommerce', 'libre_market', etc.
  name:          text('name').notNull(),             // display name
  url:           text('url').notNull(),              // storefront URL
  connectorType: text('connector_type').notNull(),  // 'woocommerce_api' | 'shopify_api' | 'ebay_api' | 'browser'
  enabled:       integer('enabled').notNull().default(1),
  config:        text('config'),                    // JSON: non-sensitive platform-specific config
  lastPush:      text('last_push'),                 // ISO timestamp of last successful push
  createdAt:     text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

// ---------------------------------------------------------------------------
// Sales Analytics
// ---------------------------------------------------------------------------

// Raw ingestion snapshots (platform-agnostic).
// Store full payloads for replay/debug and keep normalized tables separate.
export const rawChannelOrders = sqliteTable('raw_channel_orders', {
  rawPk:              integer('raw_pk').primaryKey({ autoIncrement: true }),
  channelId:          text('channel_id').notNull().references(() => salesChannels.id),
  platform:           text('platform').notNull(),
  externalOrderId:    text('external_order_id').notNull(),
  externalOrderName:  text('external_order_name'),
  sourceCreatedAt:    text('source_created_at'),
  sourceUpdatedAt:    text('source_updated_at'),
  payloadJson:        text('payload_json').notNull(),
  payloadChecksum:    text('payload_checksum'),
  syncedAt:           text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_channel_orders_snapshot').on(t.channelId, t.externalOrderId, t.sourceUpdatedAt),
}))

export const rawChannelRefunds = sqliteTable('raw_channel_refunds', {
  rawPk:              integer('raw_pk').primaryKey({ autoIncrement: true }),
  channelId:          text('channel_id').notNull().references(() => salesChannels.id),
  platform:           text('platform').notNull(),
  externalRefundId:   text('external_refund_id').notNull(),
  externalOrderId:    text('external_order_id').notNull(),
  sourceCreatedAt:    text('source_created_at'),
  sourceUpdatedAt:    text('source_updated_at'),
  payloadJson:        text('payload_json').notNull(),
  payloadChecksum:    text('payload_checksum'),
  syncedAt:           text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_channel_refunds_snapshot').on(t.channelId, t.externalRefundId, t.sourceUpdatedAt),
}))

export const rawChannelTransactions = sqliteTable('raw_channel_transactions', {
  rawPk:                  integer('raw_pk').primaryKey({ autoIncrement: true }),
  channelId:              text('channel_id').notNull().references(() => salesChannels.id),
  platform:               text('platform').notNull(),
  externalTransactionId:  text('external_transaction_id').notNull(),
  externalOrderId:        text('external_order_id'),
  externalRefundId:       text('external_refund_id'),
  sourceCreatedAt:        text('source_created_at'),
  sourceUpdatedAt:        text('source_updated_at'),
  payloadJson:            text('payload_json').notNull(),
  payloadChecksum:        text('payload_checksum'),
  syncedAt:               text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_channel_transactions_snapshot').on(
    t.channelId, t.externalTransactionId, t.sourceUpdatedAt
  ),
}))

export const rawChannelFulfillments = sqliteTable('raw_channel_fulfillments', {
  rawPk:                  integer('raw_pk').primaryKey({ autoIncrement: true }),
  channelId:              text('channel_id').notNull().references(() => salesChannels.id),
  platform:               text('platform').notNull(),
  externalFulfillmentId:  text('external_fulfillment_id').notNull(),
  externalOrderId:        text('external_order_id').notNull(),
  sourceCreatedAt:        text('source_created_at'),
  sourceUpdatedAt:        text('source_updated_at'),
  payloadJson:            text('payload_json').notNull(),
  payloadChecksum:        text('payload_checksum'),
  syncedAt:               text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_channel_fulfillments_snapshot').on(
    t.channelId, t.externalFulfillmentId, t.sourceUpdatedAt
  ),
}))

// Normalized sales model.
// Amounts are stored in minor units (cents) to avoid floating-point precision issues.
export const salesOrders = sqliteTable('sales_orders', {
  orderPk:                integer('order_pk').primaryKey({ autoIncrement: true }),
  channelId:              text('channel_id').notNull().references(() => salesChannels.id),
  externalOrderId:        text('external_order_id').notNull(),
  externalOrderName:      text('external_order_name'),
  platform:               text('platform').notNull(),
  externalCheckoutId:     text('external_checkout_id'),
  customerExternalId:     text('customer_external_id'),
  customerEmail:          text('customer_email'),
  customerName:           text('customer_name'),
  customerPhone:          text('customer_phone'),
  currencyCode:           text('currency_code'),
  financialStatus:        text('financial_status'),
  fulfillmentStatus:      text('fulfillment_status'),
  orderStatus:            text('order_status'),
  sourceName:             text('source_name'),
  cancelReason:           text('cancel_reason'),
  isTestOrder:            integer('is_test_order').notNull().default(0),
  orderCreatedAt:         text('order_created_at').notNull(),
  orderProcessedAt:       text('order_processed_at'),
  orderUpdatedAt:         text('order_updated_at'),
  orderCancelledAt:       text('order_cancelled_at'),
  orderClosedAt:          text('order_closed_at'),
  subtotalAmountCents:    integer('subtotal_amount_cents'),
  discountAmountCents:    integer('discount_amount_cents'),
  shippingAmountCents:    integer('shipping_amount_cents'),
  taxAmountCents:         integer('tax_amount_cents'),
  totalAmountCents:       integer('total_amount_cents'),
  refundedAmountCents:    integer('refunded_amount_cents').notNull().default(0),
  netAmountCents:         integer('net_amount_cents'),
  shippingName:           text('shipping_name'),
  shippingCity:           text('shipping_city'),
  shippingRegion:         text('shipping_region'),
  shippingCountry:        text('shipping_country'),
  shippingPostalCode:     text('shipping_postal_code'),
  billingName:            text('billing_name'),
  billingCity:            text('billing_city'),
  billingRegion:          text('billing_region'),
  billingCountry:         text('billing_country'),
  billingPostalCode:      text('billing_postal_code'),
  tags:                   text('tags'),
  note:                   text('note'),
  rawSourceTable:         text('raw_source_table').notNull(),
  rawSourceId:            text('raw_source_id').notNull(),
  insertedAt:             text('inserted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt:              text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqExternalOrder: uniqueIndex('uq_sales_orders_external').on(t.channelId, t.externalOrderId),
}))

export const salesOrderItems = sqliteTable('sales_order_items', {
  orderItemPk:               integer('order_item_pk').primaryKey({ autoIncrement: true }),
  orderPk:                   integer('order_pk').notNull().references(() => salesOrders.orderPk),
  externalLineItemId:        text('external_line_item_id'),
  externalProductId:         text('external_product_id'),
  externalVariantId:         text('external_variant_id'),
  sku:                       text('sku'),
  productKey:                text('product_key'),
  productTitle:              text('product_title'),
  variantTitle:              text('variant_title'),
  vendor:                    text('vendor'),
  quantity:                  integer('quantity').notNull(),
  currentQuantity:           integer('current_quantity'),
  refundableQuantity:        integer('refundable_quantity'),
  unitPriceAmountCents:      integer('unit_price_amount_cents'),
  lineSubtotalAmountCents:   integer('line_subtotal_amount_cents'),
  lineDiscountAmountCents:   integer('line_discount_amount_cents'),
  lineTotalAmountCents:      integer('line_total_amount_cents'),
  requiresShipping:          integer('requires_shipping'),
  taxable:                   integer('taxable'),
  fulfillmentStatus:         text('fulfillment_status'),
  insertedAt:                text('inserted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const salesRefunds = sqliteTable('sales_refunds', {
  refundPk:                 integer('refund_pk').primaryKey({ autoIncrement: true }),
  orderPk:                  integer('order_pk').notNull().references(() => salesOrders.orderPk),
  channelId:                text('channel_id').notNull().references(() => salesChannels.id),
  externalRefundId:         text('external_refund_id').notNull(),
  externalOrderId:          text('external_order_id').notNull(),
  currencyCode:             text('currency_code'),
  refundCreatedAt:          text('refund_created_at'),
  refundProcessedAt:        text('refund_processed_at'),
  refundTotalAmountCents:   integer('refund_total_amount_cents'),
  refundNotes:              text('refund_notes'),
  rawSourceTable:           text('raw_source_table').notNull(),
  rawSourceId:              text('raw_source_id').notNull(),
  insertedAt:               text('inserted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqExternalRefund: uniqueIndex('uq_sales_refunds_external').on(t.channelId, t.externalRefundId),
}))

export const salesRefundItems = sqliteTable('sales_refund_items', {
  refundItemPk:                 integer('refund_item_pk').primaryKey({ autoIncrement: true }),
  refundPk:                     integer('refund_pk').notNull().references(() => salesRefunds.refundPk),
  orderItemPk:                  integer('order_item_pk').references(() => salesOrderItems.orderItemPk),
  externalRefundLineItemId:     text('external_refund_line_item_id'),
  externalLineItemId:           text('external_line_item_id'),
  sku:                          text('sku'),
  quantity:                     integer('quantity'),
  subtotalAmountCents:          integer('subtotal_amount_cents'),
  taxAmountCents:               integer('tax_amount_cents'),
})

export const salesTransactions = sqliteTable('sales_transactions', {
  transactionPk:                integer('transaction_pk').primaryKey({ autoIncrement: true }),
  orderPk:                      integer('order_pk').references(() => salesOrders.orderPk),
  refundPk:                     integer('refund_pk').references(() => salesRefunds.refundPk),
  channelId:                    text('channel_id').notNull().references(() => salesChannels.id),
  externalTransactionId:        text('external_transaction_id').notNull(),
  externalOrderId:              text('external_order_id'),
  kind:                         text('kind'),
  status:                       text('status'),
  gateway:                      text('gateway'),
  amountCents:                  integer('amount_cents'),
  currencyCode:                 text('currency_code'),
  transactionCreatedAt:         text('transaction_created_at'),
  rawSourceTable:               text('raw_source_table').notNull(),
  rawSourceId:                  text('raw_source_id').notNull(),
  insertedAt:                   text('inserted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqExternalTransaction: uniqueIndex('uq_sales_transactions_external').on(
    t.channelId, t.externalTransactionId
  ),
}))

export const salesFulfillments = sqliteTable('sales_fulfillments', {
  fulfillmentPk:                integer('fulfillment_pk').primaryKey({ autoIncrement: true }),
  orderPk:                      integer('order_pk').notNull().references(() => salesOrders.orderPk),
  channelId:                    text('channel_id').notNull().references(() => salesChannels.id),
  externalFulfillmentId:        text('external_fulfillment_id').notNull(),
  externalOrderId:              text('external_order_id'),
  status:                       text('status'),
  trackingCompany:              text('tracking_company'),
  trackingNumber:               text('tracking_number'),
  trackingUrl:                  text('tracking_url'),
  fulfillmentCreatedAt:         text('fulfillment_created_at'),
  fulfillmentUpdatedAt:         text('fulfillment_updated_at'),
  rawSourceTable:               text('raw_source_table').notNull(),
  rawSourceId:                  text('raw_source_id').notNull(),
  insertedAt:                   text('inserted_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqExternalFulfillment: uniqueIndex('uq_sales_fulfillments_external').on(
    t.channelId, t.externalFulfillmentId
  ),
}))

export const salesFulfillmentItems = sqliteTable('sales_fulfillment_items', {
  fulfillmentItemPk:            integer('fulfillment_item_pk').primaryKey({ autoIncrement: true }),
  fulfillmentPk:                integer('fulfillment_pk').notNull().references(() => salesFulfillments.fulfillmentPk),
  orderItemPk:                  integer('order_item_pk').references(() => salesOrderItems.orderItemPk),
  externalLineItemId:           text('external_line_item_id'),
  sku:                          text('sku'),
  quantity:                     integer('quantity'),
})

export const salesSyncCursors = sqliteTable('sales_sync_cursors', {
  channelId:                text('channel_id').notNull().references(() => salesChannels.id),
  resourceType:             text('resource_type').notNull(), // orders|refunds|transactions|fulfillments
  lastSourceUpdatedAt:      text('last_source_updated_at'),
  lastExternalId:           text('last_external_id'),
  lastSyncAt:               text('last_sync_at'),
  lastStatus:               text('last_status'),
  lastError:                text('last_error'),
  updatedAt:                text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({ pk: primaryKey({ columns: [t.channelId, t.resourceType] }) }))

// Google Ads raw snapshots
export const rawGoogleAdsCampaigns = sqliteTable('raw_google_ads_campaigns', {
  rawPk:         integer('raw_pk').primaryKey({ autoIncrement: true }),
  customerId:    text('customer_id').notNull(),
  campaignId:    text('campaign_id').notNull(),
  segmentsDate:  text('segments_date'),
  payloadJson:   text('payload_json').notNull(),
  syncedAt:      text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_google_ads_campaigns_snapshot').on(t.customerId, t.campaignId, t.segmentsDate),
}))

export const rawGoogleAdsAdGroups = sqliteTable('raw_google_ads_ad_groups', {
  rawPk:         integer('raw_pk').primaryKey({ autoIncrement: true }),
  customerId:    text('customer_id').notNull(),
  campaignId:    text('campaign_id'),
  adGroupId:     text('ad_group_id').notNull(),
  segmentsDate:  text('segments_date'),
  payloadJson:   text('payload_json').notNull(),
  syncedAt:      text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_google_ads_ad_groups_snapshot').on(t.customerId, t.adGroupId, t.segmentsDate),
}))

export const rawGoogleAdsClickViews = sqliteTable('raw_google_ads_click_views', {
  rawPk:         integer('raw_pk').primaryKey({ autoIncrement: true }),
  customerId:    text('customer_id').notNull(),
  gclid:         text('gclid').notNull(),
  campaignId:    text('campaign_id'),
  adGroupId:     text('ad_group_id'),
  clickDateTime: text('click_date_time'),
  segmentsDate:  text('segments_date'),
  payloadJson:   text('payload_json').notNull(),
  syncedAt:      text('synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uqSnapshot: uniqueIndex('uq_raw_google_ads_click_views_snapshot').on(t.customerId, t.gclid, t.clickDateTime),
}))

export const googleAdsCampaigns = sqliteTable('google_ads_campaigns', {
  customerId:              text('customer_id').notNull(),
  campaignId:              text('campaign_id').notNull(),
  name:                    text('name'),
  status:                  text('status'),
  advertisingChannelType:  text('advertising_channel_type'),
  startDate:               text('start_date'),
  endDate:                 text('end_date'),
  currencyCode:            text('currency_code'),
  budgetMicros:            integer('budget_micros'),
  lastSyncedAt:            text('last_synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({ pk: primaryKey({ columns: [t.customerId, t.campaignId] }) }))

export const googleAdsAdGroups = sqliteTable('google_ads_ad_groups', {
  customerId:              text('customer_id').notNull(),
  adGroupId:               text('ad_group_id').notNull(),
  campaignId:              text('campaign_id'),
  name:                    text('name'),
  status:                  text('status'),
  type:                    text('type'),
  cpcBidMicros:            integer('cpc_bid_micros'),
  lastSyncedAt:            text('last_synced_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({ pk: primaryKey({ columns: [t.customerId, t.adGroupId] }) }))

export const salesOrderMarketing = sqliteTable('sales_order_marketing', {
  orderPk:       integer('order_pk').primaryKey().references(() => salesOrders.orderPk),
  landingSite:   text('landing_site'),
  referringSite: text('referring_site'),
  utmSource:     text('utm_source'),
  utmMedium:     text('utm_medium'),
  utmCampaign:   text('utm_campaign'),
  utmTerm:       text('utm_term'),
  utmContent:    text('utm_content'),
  gclid:         text('gclid'),
  fbclid:        text('fbclid'),
  ttclid:        text('ttclid'),
  sourceJson:    text('source_json'),
  updatedAt:     text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const salesOrderAttribution = sqliteTable('sales_order_attribution', {
  orderPk:           integer('order_pk').primaryKey().references(() => salesOrders.orderPk),
  model:             text('model').notNull(),
  confidence:        real('confidence'),
  googleCustomerId:  text('google_customer_id'),
  campaignId:        text('campaign_id'),
  adGroupId:         text('ad_group_id'),
  gclid:             text('gclid'),
  clickTime:         text('click_time'),
  notes:             text('notes'),
  attributedAt:      text('attributed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

// Social media publishing pipeline
export const socialMediaAccounts = sqliteTable('social_media_accounts', {
  id:        text('id').primaryKey(),
  label:     text('label').notNull(),
  platform:  text('platform').notNull(),
  handle:    text('handle').notNull(),
  isActive:  integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const socialMediaPosts = sqliteTable('social_media_posts', {
  postPk:         integer('post_pk').primaryKey({ autoIncrement: true }),
  accountId:      text('account_id').notNull().references(() => socialMediaAccounts.id),
  content:        text('content').notNull(),
  imageUrl:       text('image_url'),
  imageUrls:      text('image_urls'),
  scheduledFor:   text('scheduled_for').notNull(),
  status:         text('status').notNull().default('suggested'),
  externalPostId: text('external_post_id'),
  publishedAt:    text('published_at'),
  createdBy:      text('created_by').notNull().default('agent'),
  createdAt:      text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt:      text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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

// ---------------------------------------------------------------------------
// Platform Tokens (Shopify OAuth — refreshed daily via UI button)
// ---------------------------------------------------------------------------

export const platformTokens = sqliteTable('platform_tokens', {
  platform:    text('platform').primaryKey(), // 'shopify_komputerzz' | 'shopify_tiktok'
  accessToken: text('access_token').notNull(),
  expiresAt:   text('expires_at').notNull(),   // ISO timestamp
  refreshedAt: text('refreshed_at').notNull(), // ISO timestamp
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

export const runnerSignals = sqliteTable('runner_signals', {
  runner:      text('runner').primaryKey(), // e.g. 'browser'
  wakeNonce:   integer('wake_nonce').notNull().default(0),
  reason:      text('reason'),
  requestedAt: text('requested_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt:   text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product:  one(products,   { fields: [productCategories.productId],  references: [products.id] }),
  category: one(categories, { fields: [productCategories.categoryId], references: [categories.id] }),
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

export const productMetafieldsRelations = relations(productMetafields, ({ one }) => ({
  product: one(products, { fields: [productMetafields.productId], references: [products.id] }),
}))

export const tiktokSelectionRelations = relations(tiktokSelection, ({ one }) => ({
  product: one(products, { fields: [tiktokSelection.productId], references: [products.id] }),
}))

export const categoriesRelations = relations(categories, ({ many }) => ({
  productCategories: many(productCategories),
}))
