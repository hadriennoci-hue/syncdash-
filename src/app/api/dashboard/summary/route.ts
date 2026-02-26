import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouseStock, platformMappings, salesChannels, products } from '@/lib/db/schema'
import { eq, or, and, like, sql } from 'drizzle-orm'
import { WAREHOUSE_LABELS } from '@/types/platform'

const ACTIVE_WAREHOUSES = ['ireland', 'acer_store'] as const

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const [stockRows, mappingRows, channels] = await Promise.all([
    db.query.warehouseStock.findMany({ columns: { warehouseId: true, quantity: true } }),
    db.query.platformMappings.findMany({ columns: { platform: true } }),
    db.query.salesChannels.findMany({ where: eq(salesChannels.enabled, 1) }),
  ])

  const pushWhere = and(
    or(
      eq(products.pushedWoocommerce, '2push'),
      eq(products.pushedShopifyKomputerzz, '2push'),
      eq(products.pushedShopifyTiktok, '2push'),
      eq(products.pushedLibreMarket, '2push'),
      eq(products.pushedXmrBazaar, '2push'),
      like(products.pushedWoocommerce, 'FAIL:%'),
      like(products.pushedShopifyKomputerzz, 'FAIL:%'),
      like(products.pushedShopifyTiktok, 'FAIL:%'),
      like(products.pushedLibreMarket, 'FAIL:%'),
      like(products.pushedXmrBazaar, 'FAIL:%')
    ),
    sql`EXISTS (
      SELECT 1
      FROM warehouse_stock ws
      WHERE ws.product_id = ${products.id}
        AND ws.quantity > 0
    )`
  )

  const [readyCountRow, readyRows] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(products).where(pushWhere),
    db.query.products.findMany({
      where: pushWhere,
      columns: { id: true },
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
      limit: 200,
    }),
  ])

  // Count refs in stock per warehouse (quantity > 0)
  const stockCounts: Record<string, number> = {}
  for (const row of stockRows) {
    if (row.quantity > 0) {
      stockCounts[row.warehouseId] = (stockCounts[row.warehouseId] ?? 0) + 1
    }
  }

  // Count refs listed per channel
  const listingCounts: Record<string, number> = {}
  for (const row of mappingRows) {
    listingCounts[row.platform] = (listingCounts[row.platform] ?? 0) + 1
  }

  return apiResponse({
    warehouses: ACTIVE_WAREHOUSES.map((id) => ({
      id,
      label:      WAREHOUSE_LABELS[id],
      refsInStock: stockCounts[id] ?? 0,
    })),
    channels: channels.map((ch) => ({
      id:            ch.id,
      label:         ch.name,
      refsForSale:   listingCounts[ch.id] ?? 0,
      connectorType: ch.connectorType,
    })),
    readyToPush: {
      count: readyCountRow[0]?.total ?? 0,
      skus: readyRows.map((r) => r.id),
    },
  })
}
