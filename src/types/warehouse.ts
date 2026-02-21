export type WarehouseSourceType = 'shopify' | 'scraping' | 'api_tbd' | 'manual'

export interface Warehouse {
  id: string
  displayName: string
  address: string | null
  sourceType: WarehouseSourceType
  sourceConfig: Record<string, unknown> | null
  canModifyStock: boolean
  autoSync: boolean
  lastSynced: string | null
}

export interface WarehouseStockRow {
  productId: string
  warehouseId: string
  quantity: number
  quantityOrdered: number
  lastOrderDate: string | null
  purchasePrice: number | null
  updatedAt: string | null
}

export interface WarehouseStockSnapshot {
  sku: string
  quantity: number
}

export interface WarehouseDetail extends Warehouse {
  totalProducts: number
  totalStock: number
  products: Array<{
    sku: string
    title: string
    quantity: number
    quantityOrdered: number
    lastOrderDate: string | null
    purchasePrice: number | null
  }>
}
