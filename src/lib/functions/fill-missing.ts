import { db } from '@/lib/db/client'
import { products, productImages, categories as categoriesTable, productCategories, categoryMappings } from '@/lib/db/schema'
import { eq, inArray, and, sql } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { logOperation } from './log'
import { createConnector } from '@/lib/connectors/registry'
import type { Platform } from '@/types/platform'
import { firecrawlSemaphore } from '@/lib/utils/rate-limiter'
import FirecrawlApp from '@mendable/firecrawl-js'

export interface FillResult {
  sku: string
  status: 'complete' | 'filled' | 'info'
  filled: string[]
  missing: string[]
  sources: string[]
}

interface FetchedData {
  title?: string
  description?: string
  images?: { url: string; alt: string | null }[]
  categories?: { platformId: string; name: string; slug: string | null; platform: string }[]
}

function countStoredTags(raw: string | null): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return 0
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && !/\s/.test(v))
      .length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function fillMissingFields(sku: string, triggeredBy: 'human' | 'agent' = 'human'): Promise<FillResult> {
  const product = await db.query.products.findFirst({
    where: eq(products.id, sku),
    with: { images: true, categories: true },
  })
  if (!product) throw new Error(`Product ${sku} not found`)

  // Keep Shopify/Woo category links in sync even when the product already has categories.
  await syncBidirectionalCategoryLinksForProduct(sku)

  const state = {
    hasTitle: product.title !== sku && product.title.trim().length > 0,
    hasImages: product.images.length >= 2,
    hasDescription: !!product.description?.trim(),
    hasCategories: product.categories.length > 0,
    hasTags: countStoredTags(product.tags) >= 3,
  }

  if (isComplete(state)) {
    if (product.status === 'info') {
      await db.update(products)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(products.id, sku))
      await logOperation({
        productId: sku,
        action: 'fill_missing',
        status: 'success',
        message: 'Already complete — status set to active',
        triggeredBy,
      })
    }
    return { sku, status: 'complete', filled: [], missing: [], sources: [] }
  }

  const filled: string[] = []
  const sources: string[] = []

  // Priority order: Komputerzz -> TikTok -> WooCommerce -> Acer (Firecrawl)
  const fetchOrder: Array<() => Promise<FetchedData | null>> = [
    () => fetchFromPlatformBySku(sku, 'shopify_komputerzz'),
    () => fetchFromPlatformBySku(sku, 'shopify_tiktok'),
    () => fetchFromPlatformBySku(sku, 'woocommerce'),
    () => fetchFromFirecrawl(sku),
  ]
  const sourceNames = ['shopify_komputerzz', 'shopify_tiktok', 'woocommerce', 'acer_store']

  for (const [i, fetchFn] of fetchOrder.entries()) {
    if (isComplete(state)) break
    try {
      const data = await fetchFn()
      if (!data) continue
      sources.push(sourceNames[i])
      await applyData(sku, data, state, filled)
    } catch {
      // source unavailable -> continue
    }
  }

  const missing = getMissing(state)
  if (missing.length > 0) {
    await db.update(products)
      .set({ status: 'info', updatedAt: new Date().toISOString() })
      .where(eq(products.id, sku))
    await logOperation({
      productId: sku,
      action: 'fill_missing',
      status: 'error',
      message: `Still missing: ${missing.join(', ')}`,
      triggeredBy,
    })
    return { sku, status: 'info', filled, missing, sources }
  }

  await db.update(products)
    .set({ status: product.status === 'info' ? 'active' : product.status, updatedAt: new Date().toISOString() })
    .where(eq(products.id, sku))
  await logOperation({
    productId: sku,
    action: 'fill_missing',
    status: 'success',
    message: `Filled: ${filled.join(', ')} from ${sources.join(', ')}`,
    triggeredBy,
  })
  return { sku, status: 'filled', filled, missing: [], sources }
}

// ---------------------------------------------------------------------------
// Apply fetched data to D1
// ---------------------------------------------------------------------------

async function applyData(
  sku: string,
  data: FetchedData,
  state: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean; hasTags: boolean },
  filled: string[]
) {
  const update: Record<string, unknown> = {}

  if (!state.hasTitle && data.title && data.title !== sku && data.title.trim().length > 0) {
    update.title = data.title
    state.hasTitle = true
    filled.push('title')
  }
  if (!state.hasDescription && data.description?.trim()) {
    update.description = data.description
    state.hasDescription = true
    filled.push('description')
  }

  if (Object.keys(update).length > 0) {
    await db.update(products).set(update).where(eq(products.id, sku))
  }

  if (!state.hasImages && data.images && data.images.length >= 1) {
    // Get current count first
    const current = await db.query.productImages.findMany({ where: eq(productImages.productId, sku) })
    const needed = 5 - current.length
    const toAdd = data.images.slice(0, needed)
    const startPos = current.length

    for (const [i, img] of toAdd.entries()) {
      await db.insert(productImages).values({
        id: generateId(), productId: sku, url: img.url, alt: img.alt, position: startPos + i,
      })
    }
    if (current.length + toAdd.length >= 2) {
      state.hasImages = true
      filled.push('images')
    }
  }

  if (!state.hasCategories && data.categories && data.categories.length > 0) {
    const shopifyCatIds: string[] = []
    const wooCatIds: string[] = []
    for (const cat of data.categories) {
      const catId = `${cat.platformId}`
      await db.insert(categoriesTable)
        .values({ id: catId, name: cat.name, slug: cat.slug ?? catId, platform: cat.platform, collectionType: 'product' })
        .onConflictDoUpdate({ target: categoriesTable.id, set: { name: cat.name } })
      await db.insert(productCategories)
        .values({ productId: sku, categoryId: catId })
        .onConflictDoNothing()
      if (cat.platform.startsWith('shopify')) shopifyCatIds.push(catId)
      if (cat.platform === 'woocommerce') wooCatIds.push(catId)
    }

    // For Shopify collections: cross-populate WooCommerce equivalents
    // Uses explicit category_mappings first, then falls back to case-insensitive name match.
    // Name matches are auto-saved to category_mappings for future runs.
    if (shopifyCatIds.length > 0) {
      await linkWooCommerceCategories(sku, shopifyCatIds)
    }
    if (wooCatIds.length > 0) {
      await linkShopifyCollections(sku, wooCatIds)
    }

    state.hasCategories = true
    filled.push('categories')
  }
}

// ---------------------------------------------------------------------------
// Cross-populate WooCommerce categories from Shopify collection IDs
// ---------------------------------------------------------------------------

async function linkWooCommerceCategories(sku: string, shopifyCatIds: string[]) {
  // Step 1: explicit mappings in category_mappings table
  const mapped = await db.select({
    shopifyCollectionId: categoryMappings.shopifyCollectionId,
    wooCategoryId: categoryMappings.wooCategoryId,
  })
    .from(categoryMappings)
    .where(inArray(categoryMappings.shopifyCollectionId, shopifyCatIds))

  for (const { wooCategoryId } of mapped) {
    await db.insert(productCategories).values({ productId: sku, categoryId: wooCategoryId }).onConflictDoNothing()
  }

  // Step 2: for Shopify collections not yet in category_mappings, name-match WooCommerce categories
  const alreadyMapped = new Set(mapped.map((m) => m.shopifyCollectionId))
  const unmappedIds = shopifyCatIds.filter((id) => !alreadyMapped.has(id))
  if (unmappedIds.length === 0) return

  const shopifyCats = await db.select({ id: categoriesTable.id, name: categoriesTable.name })
    .from(categoriesTable)
    .where(inArray(categoriesTable.id, unmappedIds))

  for (const shopifyCat of shopifyCats) {
    const [wooMatch] = await db.select()
      .from(categoriesTable)
      .where(and(
        eq(categoriesTable.platform, 'woocommerce'),
        sql`lower(${categoriesTable.name}) = lower(${shopifyCat.name})`,
      ))
      .limit(1)

    if (!wooMatch) continue

    // Register mapping so future runs use the explicit table
    await db.insert(categoryMappings)
      .values({ shopifyCollectionId: shopifyCat.id, wooCategoryId: wooMatch.id })
      .onConflictDoNothing()
    await db.insert(productCategories)
      .values({ productId: sku, categoryId: wooMatch.id })
      .onConflictDoNothing()
  }
}

async function linkShopifyCollections(sku: string, wooCatIds: string[]) {
  // Step 1: explicit reverse mappings in category_mappings table
  const mapped = await db.select({
    shopifyCollectionId: categoryMappings.shopifyCollectionId,
    wooCategoryId: categoryMappings.wooCategoryId,
  })
    .from(categoryMappings)
    .where(inArray(categoryMappings.wooCategoryId, wooCatIds))

  for (const { shopifyCollectionId } of mapped) {
    await db.insert(productCategories)
      .values({ productId: sku, categoryId: shopifyCollectionId })
      .onConflictDoNothing()
  }

  // Step 2: for Woo categories not yet in category_mappings, name-match Shopify collections
  const alreadyMapped = new Set(mapped.map((m) => m.wooCategoryId))
  const unmappedIds = wooCatIds.filter((id) => !alreadyMapped.has(id))
  if (unmappedIds.length === 0) return

  const wooCats = await db.select({ id: categoriesTable.id, name: categoriesTable.name })
    .from(categoriesTable)
    .where(inArray(categoriesTable.id, unmappedIds))

  for (const wooCat of wooCats) {
    const [shopifyMatch] = await db.select()
      .from(categoriesTable)
      .where(and(
        inArray(categoriesTable.platform, ['shopify_komputerzz', 'shopify_tiktok']),
        sql`lower(${categoriesTable.name}) = lower(${wooCat.name})`,
      ))
      .limit(1)

    if (!shopifyMatch) continue

    await db.insert(categoryMappings)
      .values({ shopifyCollectionId: shopifyMatch.id, wooCategoryId: wooCat.id })
      .onConflictDoNothing()
    await db.insert(productCategories)
      .values({ productId: sku, categoryId: shopifyMatch.id })
      .onConflictDoNothing()
  }
}

async function syncBidirectionalCategoryLinksForProduct(sku: string) {
  const linked = await db.select({
    categoryId: categoriesTable.id,
    platform: categoriesTable.platform,
  })
    .from(productCategories)
    .innerJoin(categoriesTable, eq(productCategories.categoryId, categoriesTable.id))
    .where(eq(productCategories.productId, sku))

  if (linked.length === 0) return

  const shopifyCatIds = linked
    .filter((c) => c.platform.startsWith('shopify'))
    .map((c) => c.categoryId)
  const wooCatIds = linked
    .filter((c) => c.platform === 'woocommerce')
    .map((c) => c.categoryId)

  if (shopifyCatIds.length > 0) await linkWooCommerceCategories(sku, shopifyCatIds)
  if (wooCatIds.length > 0) await linkShopifyCollections(sku, wooCatIds)
}

// ---------------------------------------------------------------------------
// Platform connectors (Shopify / WooCommerce)
// ---------------------------------------------------------------------------

async function fetchFromPlatformBySku(sku: string, platform: Platform): Promise<FetchedData | null> {
  const connector = await createConnector(platform)
  const platformId = await connector.findProductIdBySku?.(sku)
  if (!platformId) return null

  const raw = await connector.getProduct(platformId)
  return {
    title: raw.title,
    description: raw.description ?? undefined,
    images: raw.images.map((img) => ({ url: img.url, alt: img.alt ?? null })),
    categories: raw.collections.map((col) => ({
      platformId: platform === 'woocommerce' ? `woo_${col.platformId}` : col.platformId,
      name: col.name,
      slug: col.slug ?? null,
      platform,
    })),
  }
}

// ---------------------------------------------------------------------------
// Firecrawl (ACER Store)
// ---------------------------------------------------------------------------

async function fetchFromFirecrawl(sku: string): Promise<FetchedData | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  // Get source_url from warehouse_stock
  const { warehouseStock } = await import('@/lib/db/schema')
  const row = await db.query.warehouseStock.findFirst({
    where: (ws, { and, eq: weq, not, isNull }) =>
      and(weq(ws.productId, sku), weq(ws.warehouseId, 'acer_store'), not(isNull(ws.sourceUrl))),
  })
  const sourceUrl = row?.sourceUrl
  if (!sourceUrl || sourceUrl === 'null') return null

  const app = new FirecrawlApp({ apiKey })
  const result = await firecrawlSemaphore.run(() => app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt: 'Extract the product title, full description, and URLs of all product images. Return only high-resolution product images.',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, required: ['url'] } },
        },
      } as any,
    },
  }))
  if (!result.success) return null

  const data = (result as { extract?: { title?: string; description?: string; images?: Array<{ url: string; alt?: string }> } }).extract
  return {
    title: data?.title ?? undefined,
    description: data?.description ?? undefined,
    images: (data?.images ?? []).map((img) => ({ url: img.url, alt: img.alt ?? null })),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isComplete(s: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean; hasTags: boolean }) {
  return s.hasTitle && s.hasImages && s.hasDescription && s.hasCategories && s.hasTags
}

function getMissing(s: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean; hasTags: boolean }) {
  const m: string[] = []
  if (!s.hasTitle) m.push('title')
  if (!s.hasImages) m.push('images')
  if (!s.hasDescription) m.push('description')
  if (!s.hasCategories) m.push('categories')
  if (!s.hasTags) m.push('tags (min 3)')
  return m
}
