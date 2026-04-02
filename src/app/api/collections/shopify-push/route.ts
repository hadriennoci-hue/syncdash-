import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings, productCategories, categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import type { ShopifyConnector } from '@/lib/connectors/shopify'
import type { Platform } from '@/types/platform'
import { getStoredToken } from '@/lib/functions/tokens'
import type { ShopifyPlatform } from '@/lib/functions/tokens'

const SHOPIFY_PLATFORMS = ['shopify_tiktok', 'shopify_komputerzz'] as const

/**
 * POST /api/collections/shopify-push
 * For every product that already has a Shopify mapping, pushes its canonical
 * collection to that Shopify store via syncCollectionsToProduct.
 * Does not modify product data — collections only.
 *
 * Body: {
 *   platforms?: string[]   // default: both Shopify stores
 *   offset?: number        // for batching (default: 0)
 *   limit?: number         // products per batch (default: 30)
 * }
 * Returns: { results: { [platform]: { pushed, errors, total, done } } }
 * Keep calling with increasing offset until done = true for all platforms.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = verifyBearer(req)
    if (auth) return auth

    let targetPlatforms: readonly string[] = SHOPIFY_PLATFORMS
    let offset = 0
    let limit = 30
    try {
      const body = await req.json() as { platforms?: string[]; offset?: number; limit?: number }
      if (Array.isArray(body.platforms) && body.platforms.length > 0) {
        targetPlatforms = body.platforms.filter((p) => SHOPIFY_PLATFORMS.includes(p as typeof SHOPIFY_PLATFORMS[number]))
      }
      if (typeof body.offset === 'number') offset = body.offset
      if (typeof body.limit === 'number') limit = Math.min(body.limit, 50)
    } catch {
      // No body or invalid JSON — use defaults
    }

    const results: Record<string, { pushed: number; errors: number; total: number; done: boolean; skipped?: string }> = {}

    for (const platform of targetPlatforms) {
      const token = await getStoredToken(platform as ShopifyPlatform)
      if (!token) {
        results[platform] = { pushed: 0, errors: 0, total: 0, done: false, skipped: 'token expired — run token refresh first' }
        continue
      }
      const connector = getConnector(platform as Platform, token) as ShopifyConnector
      if (typeof connector.syncCollectionsToProduct !== 'function') {
        results[platform] = { pushed: 0, errors: 0, total: 0, done: true }
        continue
      }

      // Single JOIN query: platform_mappings × product_categories × categories
      const rows = await db
        .select({
          platformId: platformMappings.platformId,
          productId:  platformMappings.productId,
          catName:    categories.name,
          catSlug:    categories.slug,
          catId:      categories.id,
        })
        .from(platformMappings)
        .innerJoin(productCategories, eq(platformMappings.productId, productCategories.productId))
        .innerJoin(categories, eq(productCategories.categoryId, categories.id))
        .where(eq(platformMappings.platform, platform))

      // Deduplicate: one canonical collection per platformId (first wins)
      const seen = new Set<string>()
      const allTargets: Array<{ platformId: string; collection: { title: string; handle: string } }> = []
      for (const row of rows) {
        if (seen.has(row.platformId)) continue
        seen.add(row.platformId)
        allTargets.push({
          platformId: row.platformId,
          collection: { title: row.catName, handle: row.catSlug ?? row.catId },
        })
      }

      const total = allTargets.length
      const batch = allTargets.slice(offset, offset + limit)
      let pushed = 0
      let errors = 0

      for (const { platformId, collection } of batch) {
        try {
          await connector.syncCollectionsToProduct(platformId, [collection])
          pushed++
        } catch {
          errors++
        }
      }

      results[platform] = {
        pushed,
        errors,
        total,
        done: offset + batch.length >= total,
      }
    }

    return apiResponse({ results, offset, limit })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return apiError('INTERNAL_ERROR', msg, 500)
  }
}
