import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productCategories } from '@/lib/db/schema'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { inferCollection } from '@/lib/functions/collection-inference'

/**
 * POST /api/collections/infer
 * Runs inference on all products and (re)assigns collections in D1.
 * Clears all existing product_categories first.
 * Returns a summary of assignments by collection.
 */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { env } = getCloudflareContext()
  const binding = (env as Record<string, unknown>).DB as D1Database | undefined
  if (!binding) return apiError('INTERNAL_ERROR', 'D1 binding not found', 500)

  // Fetch all product ids + titles
  const allProducts = await db.select({ id: products.id, title: products.title }).from(products)

  // Run inference
  const assignments = allProducts.map((p) => ({
    productId: p.id,
    collectionId: inferCollection(p.title),
  }))

  // Clear all existing product_categories
  await binding.prepare('DELETE FROM product_categories').run()

  // Batch insert (D1 batch API — chunks of 99 to stay within binding limits)
  const CHUNK = 99
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const chunk = assignments.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '(?, ?)').join(', ')
    const values = chunk.flatMap((a) => [a.productId, a.collectionId])
    await binding.prepare(`INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES ${placeholders}`).bind(...values).run()
  }

  // Build summary
  const byCollection: Record<string, number> = {}
  for (const a of assignments) {
    byCollection[a.collectionId] = (byCollection[a.collectionId] ?? 0) + 1
  }

  return apiResponse({
    assigned: assignments.length,
    byCollection,
  })
}
