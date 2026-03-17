import { db } from '@/lib/db/client'
import { productPrices, platformMappings, products } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, SyncResult, TriggeredBy } from '@/types/platform'

type SkuAwarePriceConnector = {
  updatePriceForSku: (platformId: string, sku: string, price: number | null, compareAt?: number | null) => Promise<void>
}

function isSkuAwarePriceConnector(connector: unknown): connector is SkuAwarePriceConnector {
  return !!connector && typeof (connector as SkuAwarePriceConnector).updatePriceForSku === 'function'
}

function getPushStatusUpdate(platform: Platform): Record<string, string> {
  if (platform === 'coincart2')        return { pushedCoincart2: '2push' }
  if (platform === 'shopify_komputerzz') return { pushedShopifyKomputerzz: '2push' }
  if (platform === 'shopify_tiktok')     return { pushedShopifyTiktok: '2push' }
  if (platform === 'ebay_ie')            return { pushedEbayIe: '2push' }
  if (platform === 'xmr_bazaar')         return { pushedXmrBazaar: '2push' }
  if (platform === 'libre_market')       return { pushedLibreMarket: '2push' }
  return {}
}

export async function updateProductPrice(
  sku: string,
  prices: Partial<Record<Platform, number | null>>,
  compareAtPrices: Partial<Record<Platform, number | null>> = {},
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  const platforms = Object.keys(prices) as Platform[]

  for (const platform of platforms) {
    const price = prices[platform] ?? null
    const compareAt = compareAtPrices[platform] ?? null

    // Update D1
    const now = new Date().toISOString()
    await db.insert(productPrices).values({ productId: sku, platform, price, compareAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [productPrices.productId, productPrices.platform],
        set: { price, compareAt, updatedAt: now },
      })
    await db.update(products)
      .set(getPushStatusUpdate(platform) as Record<string, string>)
      .where(eq(products.id, sku))

    // Push to platform
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connector = await createConnector(platform)
      if (mapping.recordType === 'variant' && isSkuAwarePriceConnector(connector)) {
        await connector.updatePriceForSku(mapping.platformId, sku, price, compareAt)
      } else {
        await connector.updatePrice(mapping.platformId, price, compareAt)
      }
      await logOperation({ productId: sku, platform, action: 'update_price', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'update_price', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

