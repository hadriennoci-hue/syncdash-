import type { ImageInput } from '@/types/platform'

// ---------------------------------------------------------------------------
// Raw product — returned by platform importers before normalization
// ---------------------------------------------------------------------------

export interface RawProduct {
  platformId:       string
  sku:              string
  title:            string
  description:      string | null
  status:           'active' | 'archived'
  vendor: string | null
  productType: string | null
  taxCode: string | null
  weight: number | null
  weightUnit: string | null
  variants: RawVariant[]
  images: RawImage[]
  collections: RawCollection[]
  metafields: RawMetafield[]
  prices: { price: number | null; compareAt: number | null }
}

export interface RawVariant {
  platformId: string
  title: string | null
  sku: string | null
  price: number | null
  compareAtPrice: number | null
  stock: number
  position: number
  optionName1: string | null
  option1: string | null
  optionName2: string | null
  option2: string | null
  optionName3: string | null
  option3: string | null
  weight: number | null
}

export interface RawImage {
  platformId: string
  url: string
  position: number
  alt: string | null
  width: number | null
  height: number | null
}

export interface RawCollection {
  platformId: string
  name: string
  slug: string | null
}

export interface RawMetafield {
  namespace: string
  key: string
  value: string | null
  type: string | null
}

// ---------------------------------------------------------------------------
// Product payload — sent to platform when creating/updating
// ---------------------------------------------------------------------------
//
// Required fields for a SHOPIFY push (createProduct):
//   - title           → product name
//   - description     → canonical description text; Shopify converts this to HTML at push time
//   - price           → via variants[0].price
//   - sku             → via variants[0].sku
//   - status          → 'active' (published + in stock) or 'archived'
//   - shopifyCategory → ALWAYS 'Electronics' (GID: gid://shopify/TaxonomyCategory/el, used for tax)
//   - images          → set separately via connector.setImages() after createProduct
//
// Note: shopifyCategory (Shopify product taxonomy / tax classification) is DIFFERENT
// from categoryIds (Shopify Collections = equivalent of WooCommerce categories).
//
// Required fields for a WOOCOMMERCE push (createProduct):
//   - title           → product name (name)
//   - description     → channel description content
//   - price           → regular_price
//   - sku             → set separately via variant or product sku field
//   - status          → 'active' maps to 'publish'
//   - categoryIds     → WooCommerce category IDs (categories array)
//   - stock           → stock_status='instock' at creation (no qty needed); actual quantities
//                       are synced later by the warehouse cron via connector.updateStock()
//   - vendor          → brand attribute (attributes: [{ name:'Brand', options:[vendor] }])
//   - images          → set separately via connector.setImages() after createProduct
// ---------------------------------------------------------------------------

export interface ProductPayload {
  // Internal canonical SKU (product.id). Must be pushed as platform SKU when possible.
  sku?: string
  // Optional explicit slug/handle override for platforms that support it.
  slug?: string | null
  // EAN/GTIN barcode. Optional; skip push when empty.
  ean?: string | null
  title: string
  description: string | null
  metaDescription?: string | null
  status: 'active' | 'archived'
  vendor: string | null       // maps to WooCommerce brand attribute + Shopify vendor field
  productType: string | null
  taxCode: string | null
  price: number | null
  compareAt: number | null
  // Shopify product taxonomy category for tax purposes — always 'Electronics' for our catalogue.
  // GID: 'gid://shopify/TaxonomyCategory/el'
  // This is the Shopify standardized product type / taxonomy node, NOT collections.
  // See: https://help.shopify.com/en/manual/products/details/product-category
  shopifyCategory?: string
  variants?: VariantPayload[]
  categoryIds?: string[]
  collections?: Array<{ name: string; handle?: string | null }>
  // Generic product attributes keyed by internal attribute key.
  // Used by Coincart2 connector to push key/value lists on each product push.
  attributeValues?: Record<string, string[]>
  replaceVariants?: boolean
}

export interface ProductTranslationPayload {
  locale: string
  title?: string | null
  description?: string | null
  metaTitle?: string | null
  metaDescription?: string | null
}

export interface VariantPayload {
  title: string | null
  sku: string | null
  price: number | null
  compareAt: number | null
  stock: number
  optionName1: string | null
  option1: string | null
  optionName2: string | null
  option2: string | null
  optionName3: string | null
  option3: string | null
}

// ---------------------------------------------------------------------------
// Price snapshot — used to skip unchanged price pushes
// ---------------------------------------------------------------------------

export interface PriceSnapshot {
  price: number | null
  compareAt: number | null
}

// ---------------------------------------------------------------------------
// Health check result
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
}

// ---------------------------------------------------------------------------
// PlatformConnector interface — implemented by all channel connectors
// ---------------------------------------------------------------------------

export interface PlatformConnector {
  importProducts(): Promise<RawProduct[]>
  getProduct(platformId: string): Promise<RawProduct>
  // Optional: channel-native last modification timestamp for this product.
  // Used to protect recent manual edits from automatic stock-zero operations.
  getProductUpdatedAt?(platformId: string): Promise<string | null>
  // Optional: list channel products for stock-zero decisions (covers products
  // that may not yet exist in local platform_mappings).
  listProductsForZeroing?(): Promise<Array<{ platformId: string; sku: string | null; updatedAt: string | null }>>
  // Resolve a platform-native product ID from SKU when no mapping exists yet.
  // Returns null when the SKU is not found on that platform.
  findProductIdBySku?(sku: string): Promise<string | null>
  // Optional secondary recovery path for platforms that can rediscover an
  // existing product by title/slug when SKU mappings are missing.
  findProductIdBySlugOrTitle?(title: string): Promise<string | null>
  createProduct(data: ProductPayload): Promise<string>  // returns platformId
  updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void>
  deleteProduct(platformId: string): Promise<void>
  setImages(platformId: string, images: ImageInput[]): Promise<void>
  addImages(platformId: string, images: ImageInput[]): Promise<void>
  deleteImages(platformId: string): Promise<void>
  updatePrice(platformId: string, price: number | null, compareAt?: number | null): Promise<void>
  updateStock(platformId: string, quantity: number): Promise<void>
  // Bulk-set stock for many products in as few API calls as possible.
  // Use this instead of looping updateStock() — connectors implement platform-native batch APIs.
  bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void>
  // Optional: fetch a Map<sku, PriceSnapshot> of all products currently listed on this platform.
  // Used to skip price updates when nothing has changed.
  fetchPriceSnapshot?(): Promise<Map<string, PriceSnapshot>>
  toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void>
  assignCategories(platformId: string, categoryIds: string[]): Promise<void>
  // Optional: merge product attribute values into a Shopify collection's metafields
  // (namespace/key pairs on the collection object).
  syncCollectionAttributeValues?(
    collectionHandle: string,
    attributes: Record<string, string[]>
  ): Promise<void>
  // Optional: write product-level attribute values into Shopify product metafields.
  syncProductAttributeMetafields?(
    productGid: string,
    attributes: Record<string, string[]>
  ): Promise<void>
  syncProductTranslations?(
    productGid: string,
    translations: ProductTranslationPayload[]
  ): Promise<void>
  readProductBaseSnapshot?(
    productGid: string
  ): Promise<{
    productId: string
    title: string | null
    bodyHtml: string | null
    metaDescription: string | null
  }>
  readProductTranslationSnapshot?(
    productGid: string,
    locales: string[]
  ): Promise<{
    resourceId: string
    shopLocales: string[]
    translationsByLocale: Record<string, Array<{ key: string; value: string | null }>>
  }>
  healthCheck(): Promise<HealthCheckResult>
}

// ---------------------------------------------------------------------------
// WarehouseConnector interface — implemented by all warehouse connectors
// ---------------------------------------------------------------------------

export interface WarehouseStockSnapshot {
  sku: string
  quantity: number
  sourceUrl?: string      // product page on the source site — used to scrape missing listings
  sourceName?: string     // product name as it appears on the source
  description?: string | null
  importPrice?: number | null       // listed price scraped from source (e.g. ACER Store regular price)
  importPromoPrice?: number | null  // promo/discounted price scraped from source
}

export interface WarehouseStockProgress {
  stage: 'start' | 'url_started' | 'page_done' | 'url_done' | 'fetch_done'
  warehouseId?: string
  message: string
  current: number
  total: number
  url?: string
  pageUrl?: string
}

export interface WarehouseStockOptions {
  onProgress?: (event: WarehouseStockProgress) => void
}

export interface WarehouseConnector {
  getStock(options?: WarehouseStockOptions): Promise<WarehouseStockSnapshot[]>
  healthCheck(): Promise<HealthCheckResult>
}
