import { db } from '@/lib/db/client'
import { productPrices, platformMappings } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, SyncResult, TriggeredBy } from '@/types/platform'

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
    await db.insert(productPrices).values({ productId: sku, platform, price, compareAt })
      .onConflictDoUpdate({
        target: [productPrices.productId, productPrices.platform],
        set: { price, compareAt },
      })

    // Push to platform
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      await getConnector(platform).updatePrice(mapping.platformId, price, compareAt)
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
