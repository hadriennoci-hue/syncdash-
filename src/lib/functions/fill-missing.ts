import { db } from '@/lib/db/client'
import { productPrices, products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logOperation } from './log'
import { ATTRIBUTE_OPTIONS } from '@/lib/constants/product-attribute-options'
import { firecrawlSemaphore } from '@/lib/utils/rate-limiter'
import FirecrawlApp from '@mendable/firecrawl-js'

export interface FillResult {
  sku: string
  status: 'complete' | 'filled' | 'info'
  filled: string[]
  missing: string[]
  sources: string[]
}

interface ProductState {
  hasName: boolean
  hasSku: boolean
  hasDescription: boolean
  hasImages: boolean
  hasTags: boolean
  hasPrice: boolean
  hasCollection: boolean
  hasLaptopAttributes: boolean
  hasLaptopOptions: boolean
  hasDisplayAttributes: boolean
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && !/\s/.test(v))
  } catch {
    return []
  }
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

function splitAttributeValues(value: string): string[] {
  return value
    .split(/[|,/;]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function getAttributeMap(metafields: Array<{ namespace: string; key: string; value: string | null }>): Map<string, string> {
  const out = new Map<string, string>()
  for (const mf of metafields) {
    if (mf.namespace !== 'attributes') continue
    const key = mf.key.trim().toLowerCase()
    const value = (mf.value ?? '').trim()
    if (!key || !value) continue
    out.set(key, value)
  }
  return out
}

function includesAny(input: string, keywords: string[]): boolean {
  const n = normalizeValue(input)
  return keywords.some((k) => n.includes(k))
}

function buildState(product: {
  id: string
  title: string
  description: string | null
  tags: string | null
  images: Array<unknown>
  prices: Array<{ platform: string; price: number | null }>
  categories: Array<{ category?: { name: string; slug: string | null; platform: string } }>
  metafields: Array<{ namespace: string; key: string; value: string | null }>
}): ProductState {
  const tags = parseTags(product.tags)
  const priceRow = product.prices.find((p) => p.platform === 'coincart2')
  const collections = product.categories
    .filter((pc): pc is { category: { name: string; slug: string | null; platform: string } } => Boolean(pc.category))
    .filter((pc) => pc.category.platform !== 'coincart2')
    .map((pc) => ({ name: pc.category.name, slug: pc.category.slug ?? '' }))

  const hasCollection = collections.length > 0
  const isLaptop = collections.some((c) => includesAny(`${c.name} ${c.slug}`, ['laptop']))
  const isDisplay = collections.some((c) => includesAny(`${c.name} ${c.slug}`, ['display', 'monitor']))

  const attrs = getAttributeMap(product.metafields)
  const laptopKeys = Object.keys(ATTRIBUTE_OPTIONS.laptops)
  const displayKeys = Object.keys(ATTRIBUTE_OPTIONS.monitor)

  const hasLaptopAttributes = !isLaptop || laptopKeys.every((k) => {
    const v = attrs.get(k)
    return typeof v === 'string' && v.trim().length > 0
  })

  const hasDisplayAttributes = !isDisplay || displayKeys.every((k) => {
    const v = attrs.get(k)
    return typeof v === 'string' && v.trim().length > 0
  })

  const hasLaptopOptions = !isLaptop || laptopKeys.every((k) => {
    const allowed = ATTRIBUTE_OPTIONS.laptops[k]
    const current = attrs.get(k)
    if (!allowed || allowed.length === 0) return true
    if (!current) return false

    const allowedSet = new Set(allowed.map((v) => normalizeValue(v)))
    const values = splitAttributeValues(current)
    if (values.length === 0) return false
    return values.every((v) => allowedSet.has(normalizeValue(v)))
  })

  return {
    hasName: product.title.trim().length > 0 && product.title !== product.id,
    hasSku: product.id.trim().length > 0,
    hasDescription: Boolean(product.description?.trim()),
    hasImages: product.images.length >= 2,
    hasTags: tags.length > 0,
    hasPrice: priceRow?.price != null,
    hasCollection,
    hasLaptopAttributes,
    hasLaptopOptions,
    hasDisplayAttributes,
  }
}

function isComplete(state: ProductState): boolean {
  return state.hasName
    && state.hasSku
    && state.hasDescription
    && state.hasImages
    && state.hasTags
    && state.hasPrice
    && state.hasCollection
    && state.hasLaptopAttributes
    && state.hasLaptopOptions
    && state.hasDisplayAttributes
}

function getMissing(state: ProductState): string[] {
  const m: string[] = []
  if (!state.hasName) m.push('name')
  if (!state.hasSku) m.push('sku')
  if (!state.hasDescription) m.push('description')
  if (!state.hasImages) m.push('images (min 2)')
  if (!state.hasTags) m.push('tags')
  if (!state.hasPrice) m.push('price')
  if (!state.hasCollection) m.push('collection')
  if (!state.hasLaptopAttributes) m.push('laptop_attributes')
  if (!state.hasLaptopOptions) m.push('laptop_options')
  if (!state.hasDisplayAttributes) m.push('display_attributes')
  return m
}

function pickWarehousePriceData(
  rows: Array<{ warehouseId: string; importPrice: number | null; importPromoPrice: number | null }>
): { importPrice: number | null; importPromoPrice: number | null; source: string | null } {
  const priority = ['ireland', 'acer_store', 'poland']
  for (const warehouseId of priority) {
    const row = rows.find((r) => r.warehouseId === warehouseId)
    if (!row) continue
    if (row.importPrice != null || row.importPromoPrice != null) {
      return { importPrice: row.importPrice ?? null, importPromoPrice: row.importPromoPrice ?? null, source: warehouseId }
    }
  }
  for (const row of rows) {
    if (row.importPrice != null || row.importPromoPrice != null) {
      return { importPrice: row.importPrice ?? null, importPromoPrice: row.importPromoPrice ?? null, source: row.warehouseId }
    }
  }
  return { importPrice: null, importPromoPrice: null, source: null }
}

async function scrapeDescriptionFromSourceUrl(sourceUrl: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  const app = new FirecrawlApp({ apiKey })
  const result = await firecrawlSemaphore.run(() => app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt: 'Extract only the product description text for this page.',
      schema: {
        type: 'object',
        properties: { description: { type: 'string' } },
      } as any,
    },
  }))

  if (!result.success) return null
  const extract = (result as { extract?: { description?: string } }).extract
  const description = extract?.description?.trim()
  return description && description.length > 0 ? description : null
}

async function backfillFromWarehouses(
  product: {
    id: string
    description: string | null
    prices: Array<{ platform: string; price: number | null; compareAt: number | null }>
    warehouseStock: Array<{
      warehouseId: string
      importPrice: number | null
      importPromoPrice: number | null
      sourceUrl: string | null
    }>
  },
  filled: string[],
  sources: string[]
): Promise<void> {
  const now = new Date().toISOString()
  const currentPriceRow = product.prices.find((p) => p.platform === 'coincart2') ?? null
  const isPriceMissing = currentPriceRow?.price == null
  const isPromoMissing = currentPriceRow?.compareAt == null
  const isDescriptionMissing = !product.description?.trim()

  const { importPrice, importPromoPrice, source } = pickWarehousePriceData(product.warehouseStock)
  const desiredPrice = importPromoPrice ?? importPrice
  const desiredCompareAt = importPromoPrice != null && importPrice != null && importPromoPrice < importPrice
    ? importPrice
    : null

  const nextPrice = isPriceMissing ? (desiredPrice ?? null) : (currentPriceRow?.price ?? null)
  const nextCompareAt = isPromoMissing ? (desiredCompareAt ?? null) : (currentPriceRow?.compareAt ?? null)

  if ((isPriceMissing || isPromoMissing) && (nextPrice != null || nextCompareAt != null)) {
    await db.insert(productPrices).values({
      productId: product.id,
      platform: 'coincart2',
      price: nextPrice,
      compareAt: nextCompareAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [productPrices.productId, productPrices.platform],
      set: { price: nextPrice, compareAt: nextCompareAt, updatedAt: now },
    })

    if (isPriceMissing && nextPrice != null) filled.push('price')
    if (isPromoMissing && nextCompareAt != null) filled.push('promo_price')
    if (source) sources.push(source)
  }

  if (isDescriptionMissing) {
    const sourceRow = product.warehouseStock
      .find((ws) => ws.sourceUrl && ws.sourceUrl.trim().length > 0)
    if (sourceRow?.sourceUrl) {
      const description = await scrapeDescriptionFromSourceUrl(sourceRow.sourceUrl)
      if (description) {
        await db.update(products)
          .set({ description, updatedAt: now })
          .where(eq(products.id, product.id))
        filled.push('description')
        sources.push(sourceRow.warehouseId)
      }
    }
  }
}

export async function fillMissingFields(
  sku: string,
  triggeredBy: 'human' | 'agent' = 'human'
): Promise<FillResult> {
  const load = async () => db.query.products.findFirst({
    where: eq(products.id, sku),
    with: {
      images: true,
      prices: true,
      metafields: true,
      categories: { with: { category: true } },
      warehouseStock: true,
    },
  })

  const initial = await load()
  if (!initial) throw new Error(`Product ${sku} not found`)

  const initialState = buildState(initial)
  if (isComplete(initialState)) {
    if (initial.status !== 'active') {
      await db.update(products)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(products.id, sku))
    }
    await logOperation({
      productId: sku,
      action: 'fill_missing',
      status: 'success',
      message: 'Complete - status set to active',
      triggeredBy,
    })
    return { sku, status: 'complete', filled: [], missing: [], sources: [] }
  }

  const filled: string[] = []
  const sources: string[] = []
  await backfillFromWarehouses(initial, filled, sources)

  const finalProduct = await load()
  if (!finalProduct) throw new Error(`Product ${sku} not found after backfill`)
  const finalState = buildState(finalProduct)

  if (isComplete(finalState)) {
    if (finalProduct.status !== 'active') {
      await db.update(products)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(products.id, sku))
    }
    await logOperation({
      productId: sku,
      action: 'fill_missing',
      status: 'success',
      message: `Complete after backfill: ${filled.join(', ') || 'no fields filled'}`,
      triggeredBy,
    })
    return { sku, status: 'filled', filled, missing: [], sources: [...new Set(sources)] }
  }

  const missing = getMissing(finalState)
  await logOperation({
    productId: sku,
    action: 'fill_missing',
    status: 'error',
    message: `Still incomplete: ${missing.join(', ')}`,
    triggeredBy,
  })
  return { sku, status: 'info', filled, missing, sources: [...new Set(sources)] }
}

