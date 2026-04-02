import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings, productCategories, categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import type { Platform } from '@/types/platform'

/**
 * POST /api/collections/coincart-push
 * For every product that has a Coincart mapping, pushes its canonical collection
 * via assignCategories. Supports pagination (offset/limit).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = verifyBearer(req)
    if (auth) return auth

    let offset = 0
    let limit = 30
    try {
      const body = await req.json() as { offset?: number; limit?: number }
      if (typeof body.offset === 'number') offset = body.offset
      if (typeof body.limit === 'number') limit = Math.min(body.limit, 50)
    } catch {
      // No body — use defaults
    }

    const connector = getConnector('coincart2' as Platform)

    // Single JOIN: platform_mappings × product_categories × categories for coincart2
    const rows = await db
      .select({
        platformId: platformMappings.platformId,
        productId:  platformMappings.productId,
        catName:    categories.name,
      })
      .from(platformMappings)
      .innerJoin(productCategories, eq(platformMappings.productId, productCategories.productId))
      .innerJoin(categories, eq(productCategories.categoryId, categories.id))
      .where(eq(platformMappings.platform, 'coincart2'))

    // Deduplicate: one collection per platformId (first wins)
    const seen = new Set<string>()
    const allTargets: Array<{ platformId: string; catName: string }> = []
    for (const row of rows) {
      if (seen.has(row.platformId)) continue
      seen.add(row.platformId)
      allTargets.push({ platformId: row.platformId, catName: row.catName })
    }

    const total = allTargets.length
    const batch = allTargets.slice(offset, offset + limit)
    let pushed = 0
    let errors = 0

    for (const { platformId, catName } of batch) {
      try {
        await connector.assignCategories(platformId, [`name:${catName}`])
        pushed++
      } catch {
        errors++
      }
    }

    return apiResponse({ pushed, errors, total, done: offset + batch.length >= total, offset, limit })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return apiError('INTERNAL_ERROR', msg, 500)
  }
}
