import type { ImageInput } from '@/types/platform'

// ---------------------------------------------------------------------------
// Raw product — returned by platform importers before normalization
// ---------------------------------------------------------------------------

export interface RawProduct {
  platformId: string
  sku: string
  title: string
  description: string | null
  status: 'active' | 'archived'
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
  option1: string | null
  option2: string | null
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

export interface ProductPayload {
  title: string
  description: string | null
  status: 'active' | 'archived'
  vendor: string | null
  productType: string | null
  taxCode: string | null
  price: number | null
  compareAt: number | null
  variants?: VariantPayload[]
  categoryIds?: string[]
}

export interface VariantPayload {
  title: string | null
  sku: string | null
  price: number | null
  compareAt: number | null
  stock: number
  option1: string | null
  option2: string | null
  option3: string | null
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
  createProduct(data: ProductPayload): Promise<string>  // returns platformId
  updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void>
  deleteProduct(platformId: string): Promise<void>
  setImages(platformId: string, images: ImageInput[]): Promise<void>
  addImages(platformId: string, images: ImageInput[]): Promise<void>
  deleteImages(platformId: string): Promise<void>
  updatePrice(platformId: string, price: number | null, compareAt?: number | null): Promise<void>
  updateStock(platformId: string, quantity: number): Promise<void>
  toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void>
  assignCategories(platformId: string, categoryIds: string[]): Promise<void>
  healthCheck(): Promise<HealthCheckResult>
}

// ---------------------------------------------------------------------------
// WarehouseConnector interface — implemented by all warehouse connectors
// ---------------------------------------------------------------------------

export interface WarehouseStockSnapshot {
  sku: string
  quantity: number
  sourceUrl?: string  // product page on the source site — used to scrape missing listings
  sourceName?: string // product name as it appears on the source
}

export interface WarehouseConnector {
  getStock(): Promise<WarehouseStockSnapshot[]>
  healthCheck(): Promise<HealthCheckResult>
}
