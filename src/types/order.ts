export type ArrivalStatus = 'pending' | 'arrived' | 'partial' | 'cancelled'

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  productTitle?: string
  quantity: number
  purchasePrice: number
  quantityReceived: number
}

export interface Order {
  id: string
  invoiceNumber: string
  supplierId: string | null
  supplierName?: string
  warehouseId: string | null
  warehouseDisplayName?: string
  orderDate: string
  paid: boolean
  sentToSupplier: boolean
  arrivalStatus: ArrivalStatus
  createdAt: string | null
}

export interface OrderDetail extends Order {
  items: OrderItem[]
}
