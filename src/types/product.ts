import type { Platform, PlatformStatus } from './platform'

export type ProductStatus = 'active' | 'archived'

export type RecordType = 'product' | 'variant'

export type SyncStatus = 'pending' | 'synced' | 'error'

export interface ProductVariant {
  id: string
  productId: string
  title: string | null
  sku: string | null
  price: number | null
  compareAtPrice: number | null
  stock: number
  available: boolean
  position: number
  option1: string | null
  option2: string | null
  option3: string | null
  weight: number | null
}

export interface ProductImage {
  id: string
  productId: string
  url: string
  position: number
  alt: string | null
  width: number | null
  height: number | null
}

export interface ProductPrice {
  productId: string
  platform: Platform
  price: number | null
  compareAt: number | null
}

export interface ProductMetafield {
  id: string
  productId: string
  namespace: string
  key: string
  value: string | null
  type: string | null
}

export interface PlatformMapping {
  productId: string
  platform: Platform
  platformId: string
  recordType: RecordType
  variantId: string | null
  syncStatus: SyncStatus
  lastSynced: string | null
}

export interface ProductCategory {
  id: string
  platform: string
  name: string
  slug: string | null
  parentId: string | null
  collectionType: 'product' | 'country_layout' | 'editorial'
}

export interface Product {
  id: string  // SKU
  title: string
  description: string | null
  status: ProductStatus
  taxCode: string | null
  ean: string | null
  commodityCode: string | null
  customsDescription: string | null
  countryOfManufacture: string | null
  weight: number | null
  weightUnit: string | null
  vendor: string | null
  productType: string | null
  isFeatured: boolean
  supplierId: string | null
  createdAt: string | null
  updatedAt: string | null
}

// Rich product with all relations — used in detail view
export interface ProductDetail extends Product {
  supplier: { id: string; name: string } | null
  variants: ProductVariant[]
  images: ProductImage[]
  prices: Record<Platform, { price: number | null; compareAt: number | null }>
  platformMappings: Record<Platform, { platformId: string; recordType: RecordType; syncStatus: SyncStatus } | null>
  categories: ProductCategory[]
  collections: ProductCategory[]
  localization: string | null  // 'ITA' | 'FRA' | 'POR' | etc. | null
  stock: Record<string, { quantity: number | null; quantityOrdered: number; purchasePrice: number | null }>
  inconsistencies: number
}

// Row in the product table — summary view
export interface ProductRow {
  id: string
  title: string
  status: ProductStatus
  supplier: { id: string; name: string } | null
  hasDescription: boolean
  isFeatured: boolean
  imageCount: number
  hasMinImages: boolean  // >= 5 images
  localization: string | null
  platforms: Record<Platform, {
    status: PlatformStatus
    price: number | null
    compareAt: number | null
  }>
  stock: Record<string, number | null>
  categories: string[]   // category IDs
  collections: string[]  // collection IDs
  inconsistencies: number
  updatedAt: string | null
}

// Country layout → localization code mapping
export const COUNTRY_LAYOUT_MAP: Record<string, string> = {
  'fra-azerty':   'FRA',
  'ita-qwerty':   'ITA',
  'por-qwerty':   'POR',
  'spa-qwerty':   'SPA',
  'ger-qwertz':   'GER',
  'uk-qwerty':    'UK',
  'swiss-qwertz': 'CHE',
  'swe-qwerty':   'SWE',
  'us-qwerty':    'US',
}
