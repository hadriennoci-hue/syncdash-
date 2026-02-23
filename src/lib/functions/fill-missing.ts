import { db } from '@/lib/db/client'
import { products, productImages, categories as categoriesTable, productCategories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { logOperation } from './log'
import FirecrawlApp from '@mendable/firecrawl-js'

export interface FillResult {
  sku:     string
  status:  'complete' | 'filled' | 'info'
  filled:  string[]
  missing: string[]
  sources: string[]
}

interface FetchedData {
  title?:       string
  description?: string
  images?:      { url: string; alt: string | null }[]
  categories?:  { platformId: string; name: string; slug: string | null }[]
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

  const state = {
    hasTitle:       product.title !== sku && product.title.trim().length > 0,
    hasImages:      product.images.length >= 2,
    hasDescription: !!product.description?.trim(),
    hasCategories:  product.categories.length > 0,
  }

  if (isComplete(state)) {
    return { sku, status: 'complete', filled: [], missing: [], sources: [] }
  }

  const filled:  string[] = []
  const sources: string[] = []

  // Priority order: Komputerzz → TikTok → WooCommerce → Acer (Firecrawl)
  const fetchOrder: Array<() => Promise<FetchedData | null>> = [
    () => fetchFromShopify(sku, 'komputerzz'),
    () => fetchFromShopify(sku, 'tiktok'),
    () => fetchFromWooCommerce(sku),
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
      // source unavailable — continue
    }
  }

  const missing = getMissing(state)
  if (missing.length > 0) {
    await db.update(products)
      .set({ status: 'info', updatedAt: new Date().toISOString() })
      .where(eq(products.id, sku))
    await logOperation({ productId: sku, action: 'fill_missing', status: 'error',
      message: `Still missing: ${missing.join(', ')}`, triggeredBy })
    return { sku, status: 'info', filled, missing, sources }
  }

  await db.update(products)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(products.id, sku))
  await logOperation({ productId: sku, action: 'fill_missing', status: 'success',
    message: `Filled: ${filled.join(', ')} from ${sources.join(', ')}`, triggeredBy })
  return { sku, status: 'filled', filled, missing: [], sources }
}

// ---------------------------------------------------------------------------
// Apply fetched data to D1
// ---------------------------------------------------------------------------

async function applyData(
  sku: string,
  data: FetchedData,
  state: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean },
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
    const needed  = 5 - current.length
    const toAdd   = data.images.slice(0, needed)
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
    for (const cat of data.categories) {
      const catId = `${cat.platformId}`
      await db.insert(categoriesTable)
        .values({ id: catId, name: cat.name, slug: cat.slug ?? catId, collectionType: 'product' })
        .onConflictDoUpdate({ target: categoriesTable.id, set: { name: cat.name } })
      await db.insert(productCategories)
        .values({ productId: sku, categoryId: catId })
        .onConflictDoNothing()
    }
    state.hasCategories = true
    filled.push('categories')
  }
}

// ---------------------------------------------------------------------------
// Shopify (Komputerzz or TikTok)
// ---------------------------------------------------------------------------

async function fetchFromShopify(sku: string, account: 'komputerzz' | 'tiktok'): Promise<FetchedData | null> {
  const shop  = account === 'komputerzz' ? process.env.SHOPIFY_KOMPUTERZZ_SHOP  : process.env.SHOPIFY_TIKTOK_SHOP
  const token = account === 'komputerzz' ? process.env.SHOPIFY_KOMPUTERZZ_TOKEN : process.env.SHOPIFY_TIKTOK_TOKEN
  if (!shop || !token) return null

  const res = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({
      query: `query ($q: String!) {
        productVariants(first: 1, query: $q) {
          nodes {
            product {
              title descriptionHtml
              images(first: 10) { nodes { url altText } }
              collections(first: 10) { nodes { id title handle } }
            }
          }
        }
      }`,
      variables: { q: `sku:${sku}` },
    }),
  })
  if (!res.ok) return null

  const json = await res.json() as { data?: { productVariants?: { nodes?: Array<{ product?: { title: string; descriptionHtml: string; images: { nodes: Array<{ url: string; altText?: string }> }; collections: { nodes: Array<{ id: string; title: string; handle: string }> } } }> } } }
  const p = json.data?.productVariants?.nodes?.[0]?.product
  if (!p) return null

  return {
    title:       p.title,
    description: p.descriptionHtml || null,
    images:      p.images.nodes.map((n) => ({ url: n.url, alt: n.altText ?? null })),
    categories:  p.collections.nodes.map((c) => ({ platformId: `shopify_${account}_${c.id.split('/').pop()}`, name: c.title, slug: c.handle })),
  }
}

// ---------------------------------------------------------------------------
// WooCommerce
// ---------------------------------------------------------------------------

async function fetchFromWooCommerce(sku: string): Promise<FetchedData | null> {
  const baseUrl = process.env.WOO_BASE_URL
  const key     = process.env.WOO_CONSUMER_KEY
  const secret  = process.env.WOO_CONSUMER_SECRET
  if (!baseUrl || !key || !secret) return null

  const auth = 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64')
  const search = await fetch(
    `${baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&per_page=1`,
    { headers: { Authorization: auth } }
  )
  if (!search.ok) return null
  const items = await search.json() as Array<{ id: number; name: string; description: string; images: Array<{ src: string; alt: string }>; categories: Array<{ id: number; name: string; slug: string }> }>
  if (!items[0]) return null

  const p = items[0]
  return {
    title:       p.name,
    description: p.description || null,
    images:      p.images.map((img) => ({ url: img.src, alt: img.alt ?? null })),
    categories:       p.categories.map((c) => ({ platformId: `woo_${c.id}`, name: c.name, slug: c.slug })),
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
  if (!row?.sourceUrl || row.sourceUrl === 'null') return null

  const app = new FirecrawlApp({ apiKey })
  const result = await app.scrapeUrl(row.sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt: 'Extract the product title, full description, and URLs of all product images. Return only high-resolution product images.',
      schema: {
        type: 'object',
        properties: {
          title:       { type: 'string' },
          description: { type: 'string' },
          images:      { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, required: ['url'] } },
        },
      },
    },
  })
  if (!result.success) return null

  const data = (result as { extract?: { title?: string; description?: string; images?: Array<{ url: string; alt?: string }> } }).extract
  return {
    title:       data?.title ?? undefined,
    description: data?.description ?? undefined,
    images:      (data?.images ?? []).map((img) => ({ url: img.url, alt: img.alt ?? null })),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isComplete(s: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean }) {
  return s.hasTitle && s.hasImages && s.hasDescription && s.hasCategories
}

function getMissing(s: { hasTitle: boolean; hasImages: boolean; hasDescription: boolean; hasCategories: boolean }) {
  const m: string[] = []
  if (!s.hasTitle)       m.push('title')
  if (!s.hasImages)      m.push('images')
  if (!s.hasDescription) m.push('description')
  if (!s.hasCategories)  m.push('categories')
  return m
}
