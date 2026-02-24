import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouseStock, platformMappings, salesChannels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
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
  })
}
