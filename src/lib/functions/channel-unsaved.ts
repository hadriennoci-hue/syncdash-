import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq, or, sql } from 'drizzle-orm'
import type { Platform } from '@/types/platform'

function getPushCol(platform: Platform) {
  if (platform === 'shopify_komputerzz') return products.pushedShopifyKomputerzz
  if (platform === 'shopify_tiktok')     return products.pushedShopifyTiktok
  if (platform === 'ebay_ie')            return products.pushedEbayIe
  if (platform === 'xmr_bazaar')         return products.pushedXmrBazaar
  if (platform === 'libre_market')       return products.pushedLibreMarket
  return products.pushedCoincart2
}

export interface ChannelUnsavedIssue {
  platform: Platform
  sku: string
  reason: string
}

export async function findUnsavedChannelRows(platform: Platform): Promise<ChannelUnsavedIssue[]> {
  const pushCol = getPushCol(platform)
  const rows = await db.query.products.findMany({
    where: or(eq(pushCol, '2push'), eq(pushCol, 'done'), sql`${pushCol} LIKE 'FAIL:%'`),
    columns: { id: true },
    with: {
      prices: true,
      warehouseStock: true,
    },
  })

  const issues: ChannelUnsavedIssue[] = []
  for (const row of rows) {
    const priceRow = row.prices.find((price) => price.platform === platform)
    const importPrice =
      row.warehouseStock.find((stock) => stock.warehouseId === 'ireland')?.importPrice
      ?? row.warehouseStock.find((stock) => stock.warehouseId === 'acer_store')?.importPrice
      ?? null

    if (priceRow?.price == null && importPrice != null) {
      issues.push({
        platform,
        sku: row.id,
        reason: 'channel price not saved yet',
      })
    }
  }

  return issues
}
