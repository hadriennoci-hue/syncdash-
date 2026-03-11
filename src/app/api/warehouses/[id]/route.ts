import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouses, warehouseStock } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'


// GET — warehouse detail with full stock snapshot for this warehouse
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, params.id),
  })
  if (!warehouse) return apiError('NOT_FOUND', `Warehouse ${params.id} not found`, 404)

  const stock = await db.query.warehouseStock.findMany({
    where: eq(warehouseStock.warehouseId, params.id),
    with: {
      product: {
        columns: { id: true, title: true, status: true, pushedCoincart2: true, pushedShopifyKomputerzz: true, pushedShopifyTiktok: true, pushedEbayIe: true, pushedLibreMarket: true, pushedXmrBazaar: true },
        with: { categories: { with: { category: true } } },
      },
    },
    // In-stock products first, then out-of-stock products, then SKU asc.
    orderBy: (t, { asc }) => [sql`CASE WHEN ${t.quantity} > 0 THEN 0 ELSE 1 END`, asc(t.productId)],
  })

  const [lastUpdatedRow] = await db.select({
    lastUpdated: sql<string | null>`MAX(${warehouseStock.updatedAt})`,
  })
    .from(warehouseStock)
    .where(eq(warehouseStock.warehouseId, params.id))

  return apiResponse({
    id:             warehouse.id,
    displayName:    warehouse.displayName,
    address:        warehouse.address,
    sourceType:     warehouse.sourceType,
    canModifyStock: !!warehouse.canModifyStock,
    autoSync:       !!warehouse.autoSync,
    lastSynced:     warehouse.lastSynced ?? lastUpdatedRow?.lastUpdated ?? null,
    createdAt:      warehouse.createdAt,
    stock:          stock.map((s) => ({
      productId:                s.productId,
      productTitle:             s.product?.title ?? null,
      productStatus:            s.product?.status ?? null,
      pushedCoincart2:        s.product?.pushedCoincart2 ?? 'N',
      pushedShopifyKomputerzz:  s.product?.pushedShopifyKomputerzz ?? 'N',
      pushedShopifyTiktok:      s.product?.pushedShopifyTiktok ?? 'N',
      pushedEbayIe:             s.product?.pushedEbayIe ?? 'N',
      pushedLibreMarket:        s.product?.pushedLibreMarket ?? 'N',
      pushedXmrBazaar:          s.product?.pushedXmrBazaar ?? 'N',
      quantity:                 s.quantity,
      quantityOrdered:          s.quantityOrdered ?? 0,
      lastOrderDate:            s.lastOrderDate,
      purchasePrice:            s.purchasePrice,
      updatedAt:                s.updatedAt,
      categories:               (s.product?.categories ?? []).map((pc) => pc.category.name),
    })),
  })
}

