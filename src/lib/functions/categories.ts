import { db } from '@/lib/db/client'
import { productCategories, platformMappings } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, SyncResult, TriggeredBy } from '@/types/platform'

export async function assignCategories(
  sku: string,
  categoryIds: string[],
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  // Update D1
  await db.delete(productCategories).where(eq(productCategories.productId, sku))
  for (const catId of categoryIds) {
    await db.insert(productCategories)
      .values({ productId: sku, categoryId: catId })
      .onConflictDoNothing()
  }

  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connector = await createConnector(platform)
      await connector.assignCategories(mapping.platformId, categoryIds)
      await logOperation({ productId: sku, platform, action: 'assign_categories', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'assign_categories', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}
