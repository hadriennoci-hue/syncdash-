import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productImages, platformMappings, categories as categoriesTable, productCategories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { logOperation } from '@/lib/functions/log'
import { createConnector } from '@/lib/connectors/registry'
import type { Platform } from '@/types/platform'

const schema = z.object({
  platform:    z.string(),
  fields:      z.array(z.enum(['title', 'description', 'images', 'categories'])).default(['title', 'description', 'images', 'categories']),
  maxImages:   z.number().int().min(1).max(20).default(5),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const { platform, fields, maxImages, triggeredBy } = parsed.data
  const sku = params.sku

  try {
    const product = await db.query.products.findFirst({ where: eq(products.id, sku) })
    if (!product) return apiError('NOT_FOUND', `Product ${sku} not found`, 404)

  // Find the platform mapping (to get platformId)
  // If not mapped yet, look up by SKU directly via connector
    const mapping = await db.query.platformMappings.findFirst({
      where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
    })

    const t0 = Date.now()
    const connector = await createConnector(platform as Platform)

    let platformId: string
    if (mapping) {
      platformId = mapping.platformId
    } else {
      const resolvedId = await connector.findProductIdBySku?.(sku)
      if (!resolvedId) return apiError('NOT_FOUND', `Product ${sku} not found on ${platform}`, 404)
      platformId = resolvedId
    }

    const raw = await connector.getProduct(platformId)
    const latencyMs = Date.now() - t0

    const updated: Record<string, unknown> = {}

    if (fields.includes('title') && raw.title && raw.title !== sku) {
      updated.title = raw.title
    }
    if (fields.includes('description') && raw.description !== undefined) {
      updated.description = raw.description
    }
    if (Object.keys(updated).length > 0) {
      updated.updatedAt = new Date().toISOString()
      await db.update(products).set(updated).where(eq(products.id, sku))
    }

  // Images
    let imagesFetched = 0
    if (fields.includes('images') && raw.images.length > 0) {
      const toInsert = raw.images.slice(0, maxImages)
      await db.delete(productImages).where(eq(productImages.productId, sku))
      for (const [i, img] of toInsert.entries()) {
        await db.insert(productImages).values({
          id:        generateId(),
          productId: sku,
          url:       img.url,
          alt:       img.alt,
          position:  i,
        })
      }
      imagesFetched = toInsert.length
    }

  // Categories — upsert as WooCommerce category slugs into categories + product_categories
    let categoriesImported = 0
    if (fields.includes('categories') && raw.collections.length > 0) {
      for (const col of raw.collections) {
        const catId = `woo_${col.platformId}`
        await db.insert(categoriesTable)
          .values({ id: catId, platform, name: col.name, slug: col.slug ?? catId, collectionType: 'product' })
          .onConflictDoUpdate({ target: categoriesTable.id, set: { name: col.name } })
        await db.insert(productCategories)
          .values({ productId: sku, categoryId: catId })
          .onConflictDoNothing()
      }
      categoriesImported = raw.collections.length
    }

  // Ensure platform mapping exists
    if (!mapping) {
      await db.insert(platformMappings)
        .values({ productId: sku, platform, platformId, syncStatus: 'synced' })
        .onConflictDoNothing()
    }

    await logOperation({
      productId: sku,
      platform,
      action:    'pull_from_channel',
      status:    'success',
      message:   `Pulled from ${platform}: images=${imagesFetched}, cats=${categoriesImported}, latency=${latencyMs}ms`,
      triggeredBy,
    })

    return apiResponse({
      sku,
      platform,
      platformId,
      latencyMs,
      fieldsUpdated: Object.keys(updated),
      imagesFetched,
      categoriesImported,
      rawTitle: raw.title,
    })
  } catch (err) {
    return apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
