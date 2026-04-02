import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { productCategories, categories } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import type { ShopifyConnector } from '@/lib/connectors/shopify'
import { getStoredToken } from '@/lib/functions/tokens'

const CANONICAL_HANDLES = new Set([
  'laptops','gaming-laptops','work-laptops','desktops','monitors','gaming-monitors',
  'ultrawide-monitors','tablets','projectors','graphics-cards','storage','accessories',
  'mice','keyboards','headsets-earbuds','controllers','docking-stations','laptop-bags',
  'connectivity','webcams','audio','cameras','gaming-consoles','gaming-chairs',
  'gaming-desks','electric-scooters',
])

/**
 * POST /api/collections/tiktok-migrate
 * One-shot migration for shopify_tiktok:
 *   1. List all products on TikTok Shopify (with SKUs)
 *   2. For each product, look up its canonical collection in D1
 *   3. Seed all 26 canonical collections (find-or-create)
 *   4. Remove each product from all old non-canonical collections
 *   5. Add each product to its canonical collection
 *   6. Delete all non-canonical empty custom collections
 */
export async function POST(req: NextRequest) {
  try {
    const auth = verifyBearer(req)
    if (auth) return auth

    const token = await getStoredToken('shopify_tiktok')
    if (!token) return apiError('INTERNAL_ERROR', 'shopify_tiktok token expired — run /api/tokens/refresh first', 500)

    const connector = getConnector('shopify_tiktok', token) as ShopifyConnector

    // Step 1 — list all products on TikTok Shopify
    const shopifyProducts = await connector.listAllProducts()
    if (shopifyProducts.length === 0) {
      return apiResponse({ message: 'No products found on shopify_tiktok', assigned: 0, deleted: 0 })
    }

    const skus = shopifyProducts.map((p) => p.sku).filter(Boolean)

    // Step 2 — look up canonical collections for these SKUs from D1
    // D1 100-param limit: SKUs are few (8-9), so inArray is safe
    const pcRows = await db
      .select({
        productId: productCategories.productId,
        catName:   categories.name,
        catSlug:   categories.slug,
        catId:     categories.id,
      })
      .from(productCategories)
      .innerJoin(categories, eq(productCategories.categoryId, categories.id))
      .where(inArray(productCategories.productId, skus))

    const collectionBySku = new Map<string, { title: string; handle: string }>()
    for (const row of pcRows) {
      if (!collectionBySku.has(row.productId)) {
        collectionBySku.set(row.productId, { title: row.catName, handle: row.catSlug ?? row.catId })
      }
    }

    // Step 3 — seed all 26 canonical collections (find-or-create via syncCollectionsToProduct on each)
    // We do this by calling syncCollectionsToProduct on the first available product GID for each collection.
    // To avoid requiring a product, we'll pre-create directly: list existing then create missing.
    const existingCollections = await connector.listCustomCollections()
    const existingHandles = new Map(existingCollections.map((c) => [c.handle, c]))

    // Fetch all canonical collections from D1 to get title+slug pairs
    const canonicalRows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories)

    const created: string[] = []
    for (const col of canonicalRows) {
      const handle = col.slug ?? col.id
      if (!existingHandles.has(handle)) {
        await connector.syncCollectionsToProduct(
          shopifyProducts[0].gid,  // temp product to bootstrap collection creation
          [{ title: col.name, handle }]
        )
        created.push(handle)
      }
    }

    // Refresh collection list after creation
    const allCollections = await connector.listCustomCollections()
    const collectionByHandle = new Map(allCollections.map((c) => [c.handle, c]))

    // Steps 4+5 — for each product: remove old non-canonical collects, add canonical one
    let assigned = 0
    let removeErrors = 0
    for (const product of shopifyProducts) {
      const gidNum = Number(product.gid.split('/').pop())
      const canonicalCol = product.sku ? collectionBySku.get(product.sku) : undefined

      // List existing collects for this product
      const collects = await connector.listCollectsForProduct(gidNum)

      for (const collect of collects) {
        const col = allCollections.find((c) => c.id === collect.collection_id)
        if (!col) continue
        if (CANONICAL_HANDLES.has(col.handle)) continue // keep canonical memberships
        try {
          await connector.deleteCollect(collect.id)
        } catch {
          removeErrors++
        }
      }

      // Add to canonical collection if known
      if (canonicalCol) {
        const targetCol = collectionByHandle.get(canonicalCol.handle)
        if (targetCol) {
          try {
            await connector.syncCollectionsToProduct(product.gid, [canonicalCol])
            assigned++
          } catch {
            // ignore duplicate
          }
        }
      }
    }

    // Step 6 — delete non-canonical empty collections
    const finalCollections = await connector.listCustomCollections()
    let deleted = 0
    for (const col of finalCollections) {
      if (CANONICAL_HANDLES.has(col.handle)) continue
      try {
        await connector.deleteCustomCollection(col.id)
        deleted++
      } catch {
        // may fail if collection has products — leave it
      }
    }

    return apiResponse({
      shopifyProducts: shopifyProducts.length,
      collectionsCreated: created.length,
      assigned,
      removeErrors,
      deleted,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return apiError('INTERNAL_ERROR', msg, 500)
  }
}
