import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouses, warehouseStock } from '@/lib/db/schema'
import { eq, gt, and } from 'drizzle-orm'


// GET — warehouse detail with full stock snapshot (only in-stock products)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, params.id),
  })
  if (!warehouse) return apiError('NOT_FOUND', `Warehouse ${params.id} not found`, 404)

  const stock = await db.query.warehouseStock.findMany({
    where: and(eq(warehouseStock.warehouseId, params.id), gt(warehouseStock.quantity, 0)),
    with: {
      product: {
        columns: { id: true, title: true, status: true, pushedWoocommerce: true, pushedShopifyKomputerzz: true, pushedShopifyTiktok: true },
        with: { categories: { with: { category: true } } },
      },
    },
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
      productId:                s.productId,
      productTitle:             s.product?.title ?? null,
      productStatus:            s.product?.status ?? null,
      pushedWoocommerce:        s.product?.pushedWoocommerce ?? 'N',
      pushedShopifyKomputerzz:  s.product?.pushedShopifyKomputerzz ?? 'N',
      pushedShopifyTiktok:      s.product?.pushedShopifyTiktok ?? 'N',
      quantity:                 s.quantity,
      quantityOrdered:          s.quantityOrdered ?? 0,
      lastOrderDate:            s.lastOrderDate,
      purchasePrice:            s.purchasePrice,
      updatedAt:                s.updatedAt,
      categories:               (s.product?.categories ?? []).map((pc) => pc.category.name),
    })),
  })
}
