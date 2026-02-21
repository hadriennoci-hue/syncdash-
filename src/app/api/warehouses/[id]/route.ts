import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouses, warehouseStock } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'edge'

// GET — warehouse detail with full stock snapshot
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, params.id),
  })
  if (!warehouse) return apiError('NOT_FOUND', `Warehouse ${params.id} not found`, 404)

  const stock = await db.query.warehouseStock.findMany({
    where: eq(warehouseStock.warehouseId, params.id),
    with: { product: { columns: { id: true, title: true, status: true } } },
    orderBy: (t, { asc }) => [asc(t.productId)],
  })

  return apiResponse({
    id:             warehouse.id,
    displayName:    warehouse.displayName,
    address:        warehouse.address,
    sourceType:     warehouse.sourceType,
    canModifyStock: !!warehouse.canModifyStock,
    autoSync:       !!warehouse.autoSync,
    lastSynced:     warehouse.lastSynced,
    createdAt:      warehouse.createdAt,
    stock:          stock.map((s) => ({
      productId:       s.productId,
      productTitle:    s.product?.title ?? null,
      productStatus:   s.product?.status ?? null,
      quantity:        s.quantity,
      quantityOrdered: s.quantityOrdered ?? 0,
      lastOrderDate:   s.lastOrderDate,
      purchasePrice:   s.purchasePrice,
      updatedAt:       s.updatedAt,
    })),
  })
}
