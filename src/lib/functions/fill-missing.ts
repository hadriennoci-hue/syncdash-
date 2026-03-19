import { db } from '@/lib/db/client'
import { categories, platformMappings, productCategories, productImages, productMetafields, productPrices, products } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { logOperation } from './log'
import { ATTRIBUTE_OPTIONS } from '@/lib/constants/product-attribute-options'
import { canonicalizeAttributeValue } from './attribute-options'
import { autoLinkVariantFamily } from './variant-family'
import { firecrawlSemaphore } from '@/lib/utils/rate-limiter'
import FirecrawlApp from '@mendable/firecrawl-js'
import { generateId } from '@/lib/utils/id'
import { isUsablePlainTextDescription } from '@/lib/utils/description'
import { createConnector } from '@/lib/connectors/registry'
import type { RawCollection, RawImage, RawProduct } from '@/lib/connectors/types'

export interface FillResult {
  sku: string
  status: 'complete' | 'filled' | 'info'
  filled: string[]
  missing: string[]
  sources: string[]
}

interface ProductState {
  isLaptop: boolean
  isDisplay: boolean
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
  missingLaptopAttributeKeys: string[]
  missingDisplayAttributeKeys: string[]
}

interface FirecrawlBudget {
  descriptionCallsRemaining: number
  attributeCallsRemaining: number
  imageCallsRemaining: number
  maxAttributeKeysPerCall: number
  maxImagesPerCall: number
}

const WIZHARD_COLLECTION_PLATFORM = 'shopify_komputerzz'
const IRELAND_SOURCE_PLATFORM = 'shopify_tiktok'

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function toPlainTextLines(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(stripped)
  return decoded
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function inferCollectionSlugFromTitle(title: string): 'laptops' | 'displays' | null {
  const t = normalizeText(title)
  if (t.includes('ecran')) return 'displays'
  if (t.includes('ordinateur portable') || t.includes('convertible')) return 'laptops'
  return null
}

function normalizeCollectionSlug(slug: string | null, name: string): string {
  const base = (slug ?? name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base
}

function inferTagsFromShopify(raw: RawProduct): string[] {
  const tags: string[] = []
  const text = normalizeText(`${raw.title} ${toPlainTextLines(raw.description ?? '')}`)
  const slugText = raw.collections.map((c) => normalizeCollectionSlug(c.slug ?? null, c.name)).join(' ')

  const push = (value: string) => {
    const tag = value.trim().toLowerCase()
    if (!tag || /\s/.test(tag) || tags.includes(tag)) return
    tags.push(tag)
  }

  if (text.includes('predator')) push('predator')
  else if (text.includes('acer')) push('acer')

  if (text.includes('backpack') || text.includes('bag')) push('backpack')
  if (text.includes('mouse')) push('mouse')
  if (text.includes('controller')) push('controller')
  if (text.includes('docking')) push('docking')
  if (text.includes('headset') || text.includes('galea')) push('headset')
  if (text.includes('hotspot') || text.includes('5g')) push('hotspot')
  if (text.includes('gaming')) push('gaming')
  if (text.includes('smartphone')) push('smartphone')
  if (text.includes('wireless')) push('wireless')
  if (text.includes('urban')) push('urban')
  if (text.includes('vertical')) push('vertical')

  if (slugText.includes('laptops')) push('laptop')
  if (slugText.includes('displays')) push('monitor')
  if (slugText.includes('accessories')) push('accessories')
  if (slugText.includes('gaming')) push('gaming')
  if (slugText.includes('bags')) push('bag')
  if (slugText.includes('cases')) push('case')
  if (slugText.includes('lifestyle')) push('lifestyle')

  return tags.slice(0, 6)
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

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  const n = Math.trunc(parsed)
  if (n < min) return min
  if (n > max) return max
  return n
}

function createFirecrawlBudget(): FirecrawlBudget {
  return {
    descriptionCallsRemaining: envInt('FIRECRAWL_DESCRIPTION_CALLS_PER_PRODUCT', 1, 0, 3),
    attributeCallsRemaining: envInt('FIRECRAWL_ATTRIBUTE_CALLS_PER_PRODUCT', 1, 0, 3),
    imageCallsRemaining: envInt('FIRECRAWL_IMAGE_CALLS_PER_PRODUCT', 1, 0, 3),
    maxAttributeKeysPerCall: envInt('FIRECRAWL_MAX_ATTRIBUTE_KEYS_PER_CALL', 8, 1, 30),
    maxImagesPerCall: envInt('FIRECRAWL_MAX_IMAGES_PER_CALL', 5, 1, 10),
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

  const missingLaptopAttributeKeys = !isLaptop
    ? []
    : laptopKeys.filter((k) => {
      const v = attrs.get(k)
      return !(typeof v === 'string' && v.trim().length > 0)
    })

  const missingDisplayAttributeKeys = !isDisplay
    ? []
    : displayKeys.filter((k) => {
      const v = attrs.get(k)
      return !(typeof v === 'string' && v.trim().length > 0)
    })

  const hasLaptopAttributes = missingLaptopAttributeKeys.length === 0
  const hasDisplayAttributes = missingDisplayAttributeKeys.length === 0

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
    isLaptop,
    isDisplay,
    hasName: product.title.trim().length > 0 && product.title !== product.id,
    hasSku: product.id.trim().length > 0,
    hasDescription: isUsablePlainTextDescription(product.description),
    hasImages: product.images.length >= 1,
    hasTags: tags.length > 0,
    hasPrice: priceRow?.price != null,
    hasCollection,
    hasLaptopAttributes,
    hasLaptopOptions,
    hasDisplayAttributes,
    missingLaptopAttributeKeys,
    missingDisplayAttributeKeys,
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
  if (!state.hasImages) m.push('images (min 1)')
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

async function scrapeDescriptionFromSourceUrl(sourceUrl: string, budget: FirecrawlBudget): Promise<string | null> {
  if (budget.descriptionCallsRemaining <= 0) return null
  budget.descriptionCallsRemaining -= 1
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  const app = new FirecrawlApp({ apiKey })
  const result = await firecrawlSemaphore.run(() => app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt: 'Extract only the product description as plain text with line breaks. Do not return HTML, tags, markdown, or rich text. Preserve paragraph breaks with newline characters.',
      schema: {
        type: 'object',
        properties: { description: { type: 'string' } },
      } as any,
    },
  }))

  if (!result.success) return null
  const extract = (result as { extract?: { description?: string } }).extract
  const description = extract?.description?.trim()
  return isUsablePlainTextDescription(description) ? description : null
}

async function scrapeMissingAttributesFromSourceUrl(
  sourceUrl: string,
  missingKeys: string[],
  budget: FirecrawlBudget
): Promise<Record<string, string>> {
  if (budget.attributeCallsRemaining <= 0) return {}
  budget.attributeCallsRemaining -= 1
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey || missingKeys.length === 0) return {}
  const selectedKeys = missingKeys.slice(0, budget.maxAttributeKeysPerCall)

  const app = new FirecrawlApp({ apiKey })
  const schemaProperties: Record<string, { type: string | string[] }> = {}
  for (const key of selectedKeys) {
    schemaProperties[key] = { type: ['string', 'null'] }
  }

  const prompt =
    `Extract only these product attributes from this page: ${selectedKeys.join(', ')}. ` +
    'Return values exactly as shown on the page when possible. ' +
    'If an attribute is not visible, return null for that key.'

  const result = await firecrawlSemaphore.run(() => app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt,
      schema: {
        type: 'object',
        properties: schemaProperties,
      } as any,
    },
  }))

  if (!result.success) return {}

  const extracted = (result as { extract?: Record<string, unknown> }).extract ?? {}
  const out: Record<string, string> = {}
  for (const key of selectedKeys) {
    const raw = extracted[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    out[key] = trimmed
  }
  return out
}

function dedupeImageUrls(images: Array<{ url: string; alt: string | null }>): Array<{ url: string; alt: string | null }> {
  const out: Array<{ url: string; alt: string | null }> = []
  const seen = new Set<string>()
  for (const img of images) {
    const normalized = img.url.split('?')[0]?.trim().toLowerCase() ?? ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(img)
  }
  return out
}

async function scrapeImagesFromSourceUrl(sourceUrl: string, budget: FirecrawlBudget): Promise<Array<{ url: string; alt: string | null }>> {
  if (budget.imageCallsRemaining <= 0) return []
  budget.imageCallsRemaining -= 1
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return []

  const app = new FirecrawlApp({ apiKey })
  const result = await firecrawlSemaphore.run(() => app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt:
        'Extract ONLY high-quality product image URLs from this product page. ' +
        'Return only full-size images suitable for product gallery usage. ' +
        'Do NOT return tiny thumbnails, logos, icons, placeholders, or non-product assets.',
      schema: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                alt: { type: 'string' },
              },
              required: ['url'],
            },
          },
        },
        required: ['images'],
      } as any,
    },
  }))

  if (!result.success) return []
  const extracted = (result as { extract?: { images?: { url?: string; alt?: string }[] } }).extract
  const raw = (extracted?.images ?? [])
    .filter((img): img is { url: string; alt?: string } => typeof img?.url === 'string' && img.url.trim().length > 0)
    .map((img) => ({ url: img.url.trim(), alt: (img.alt ?? '').trim() || null }))

  return dedupeImageUrls(raw).slice(0, budget.maxImagesPerCall)
}

async function backfillMissingImages(
  product: {
    id: string
    images: Array<unknown>
    warehouseStock: Array<{
      warehouseId: string
      sourceUrl: string | null
    }>
  },
  state: ProductState,
  budget: FirecrawlBudget,
  filled: string[],
  sources: string[]
): Promise<void> {
  // Cost-control rule: never call Firecrawl for image backfill if at least one image already exists.
  if (state.hasImages || product.images.length > 0) return

  const sourceRow = product.warehouseStock.find((ws) => ws.sourceUrl && ws.sourceUrl.trim().length > 0)
  if (!sourceRow?.sourceUrl) return

  const images = await scrapeImagesFromSourceUrl(sourceRow.sourceUrl, budget)
  if (images.length === 0) return

  const now = new Date().toISOString()
  await db.delete(productImages).where(eq(productImages.productId, product.id))
  await db.insert(productImages).values(
    images.map((img, index) => ({
      id: generateId(),
      productId: product.id,
      url: img.url,
      alt: img.alt,
      position: index,
      createdAt: now,
    }))
  )

  filled.push(`images(${images.length})`)
  sources.push(sourceRow.warehouseId)
}

async function upsertShopifyCollections(
  sku: string,
  collections: RawCollection[],
  platform: typeof IRELAND_SOURCE_PLATFORM
): Promise<number> {
  if (collections.length === 0) return 0

  const categoryIds = new Set<string>()
  for (const col of collections) {
    const normalizedSlug = normalizeCollectionSlug(col.slug ?? null, col.name)
    if (!normalizedSlug) continue

    const sourceCategoryId = `${platform}_${col.platformId}`
    await db.insert(categories).values({
      id: sourceCategoryId,
      platform,
      name: col.name,
      slug: normalizedSlug,
      collectionType: 'product',
      createdAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: categories.id,
      set: { name: col.name, slug: normalizedSlug, platform, collectionType: 'product' },
    })
    categoryIds.add(sourceCategoryId)

    const wizhardCategoryId = `wizhard_${normalizedSlug}`
    await db.insert(categories).values({
      id: wizhardCategoryId,
      platform: WIZHARD_COLLECTION_PLATFORM,
      name: col.name,
      slug: normalizedSlug,
      collectionType: 'product',
      createdAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: categories.id,
      set: { name: col.name, slug: normalizedSlug, platform: WIZHARD_COLLECTION_PLATFORM, collectionType: 'product' },
    })
    categoryIds.add(wizhardCategoryId)
  }

  for (const categoryId of categoryIds) {
    await db.insert(productCategories).values({ productId: sku, categoryId }).onConflictDoNothing()
  }

  return categoryIds.size
}

async function replaceImages(sku: string, images: RawImage[]): Promise<number> {
  if (images.length === 0) return 0
  await db.delete(productImages).where(eq(productImages.productId, sku))
  await db.insert(productImages).values(
    images.slice(0, 10).map((img, index) => ({
      id: generateId(),
      productId: sku,
      url: img.url,
      alt: img.alt,
      position: img.position ?? index,
      width: img.width,
      height: img.height,
      createdAt: new Date().toISOString(),
    }))
  )
  return Math.min(images.length, 10)
}

async function backfillFromIrelandShopify(
  product: {
    id: string
    title: string
    description: string | null
    tags: string | null
    images: Array<unknown>
    categories: Array<{ category?: { name: string; slug: string | null; platform: string } }>
    warehouseStock: Array<{ warehouseId: string }>
  },
  state: ProductState,
  filled: string[],
  sources: string[]
): Promise<void> {
  const hasIrelandSource = product.warehouseStock.some((ws) => ws.warehouseId === 'ireland')
  if (!hasIrelandSource) return

  const needsDescription = !state.hasDescription
  const needsImages = !state.hasImages
  const needsCollection = !state.hasCollection
  const needsTags = !state.hasTags
  if (!needsDescription && !needsImages && !needsCollection && !needsTags) return

  const connector = await createConnector(IRELAND_SOURCE_PLATFORM)
  const platformId = await connector.findProductIdBySku?.(product.id)
  if (!platformId) return

  const raw = await connector.getProduct(platformId)
  const now = new Date().toISOString()

  if (needsDescription) {
    const description = raw.description ? toPlainTextLines(raw.description) : null
    if (isUsablePlainTextDescription(description)) {
      await db.update(products)
        .set({ description, updatedAt: now })
        .where(eq(products.id, product.id))
      filled.push('description')
      sources.push(IRELAND_SOURCE_PLATFORM)
    }
  }

  if (needsImages) {
    const inserted = await replaceImages(product.id, raw.images)
    if (inserted > 0) {
      filled.push(`images(${inserted})`)
      sources.push(IRELAND_SOURCE_PLATFORM)
    }
  }

  if (needsCollection) {
    const linked = await upsertShopifyCollections(product.id, raw.collections, IRELAND_SOURCE_PLATFORM)
    if (linked > 0) {
      filled.push('collection')
      sources.push(IRELAND_SOURCE_PLATFORM)
    }
  }

  if (needsTags) {
    const tags = inferTagsFromShopify(raw)
    if (tags.length > 0) {
      await db.update(products)
        .set({ tags: JSON.stringify(tags), updatedAt: now })
        .where(eq(products.id, product.id))
      filled.push('tags')
      sources.push(IRELAND_SOURCE_PLATFORM)
    }
  }

  await db.insert(platformMappings).values({
    productId: product.id,
    platform: IRELAND_SOURCE_PLATFORM,
    platformId,
    syncStatus: 'synced',
    lastSynced: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [platformMappings.productId, platformMappings.platform],
    set: { platformId, syncStatus: 'synced', lastSynced: now, updatedAt: now },
  })
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
  budget: FirecrawlBudget,
  filled: string[],
  sources: string[]
): Promise<void> {
  const now = new Date().toISOString()
  const currentPriceRow = product.prices.find((p) => p.platform === 'coincart2') ?? null
  const isPriceMissing = currentPriceRow?.price == null
  const isPromoMissing = currentPriceRow?.compareAt == null
  const isDescriptionMissing = !isUsablePlainTextDescription(product.description)

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
      const description = await scrapeDescriptionFromSourceUrl(sourceRow.sourceUrl, budget)
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

async function backfillMissingAttributes(
  product: {
    id: string
    status: string
    warehouseStock: Array<{
      warehouseId: string
      sourceUrl: string | null
    }>
  },
  state: ProductState,
  budget: FirecrawlBudget,
  filled: string[],
  sources: string[]
): Promise<void> {
  if (product.status === 'active') return

  const missingKeys = state.isLaptop
    ? state.missingLaptopAttributeKeys
    : state.isDisplay
      ? state.missingDisplayAttributeKeys
      : []
  if (missingKeys.length === 0) return

  const sourceRow = product.warehouseStock.find((ws) => ws.sourceUrl && ws.sourceUrl.trim().length > 0)
  if (!sourceRow?.sourceUrl) return

  const extracted = await scrapeMissingAttributesFromSourceUrl(sourceRow.sourceUrl, missingKeys, budget)
  const keys = Object.keys(extracted)
  if (keys.length === 0) return

  const collection = state.isLaptop ? 'laptops' : 'monitor'

  for (const key of keys) {
    const canonicalValue = await canonicalizeAttributeValue(collection, key, extracted[key])
    const existing = await db.query.productMetafields.findFirst({
      where: and(
        eq(productMetafields.productId, product.id),
        eq(productMetafields.namespace, 'attributes'),
        eq(productMetafields.key, key)
      ),
      columns: { id: true },
    })

    if (existing) {
      await db.update(productMetafields)
        .set({ value: canonicalValue })
        .where(eq(productMetafields.id, existing.id))
      continue
    }

    await db.insert(productMetafields).values({
      id: generateId(),
      productId: product.id,
      namespace: 'attributes',
      key,
      value: canonicalValue,
      type: 'single_line_text_field',
      createdAt: new Date().toISOString(),
    })
  }

  filled.push(`attributes(${keys.length})`)
  sources.push(sourceRow.warehouseId)
}

async function assignInferredCollection(
  productId: string,
  slug: 'laptops' | 'displays'
): Promise<void> {
  const name = slug === 'laptops' ? 'Laptops' : 'Displays'
  const categoryId = `wizhard_${slug}`

  await db.insert(categories).values({
    id: categoryId,
    platform: WIZHARD_COLLECTION_PLATFORM,
    name,
    slug,
    collectionType: 'product',
    createdAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: categories.id,
    set: { name, slug, platform: WIZHARD_COLLECTION_PLATFORM, collectionType: 'product' },
  })

  await db.insert(productCategories).values({
    productId,
    categoryId,
  }).onConflictDoNothing()
}

export async function fillMissingFields(
  sku: string,
  triggeredBy: 'human' | 'agent' = 'human'
): Promise<FillResult> {
  const firecrawlBudget = createFirecrawlBudget()
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

  if (initial.status === 'active') {
    await logOperation({
      productId: sku,
      action: 'fill_missing',
      status: 'success',
      message: 'Skipped - active product',
      triggeredBy,
    })
    return { sku, status: 'complete', filled: [], missing: [], sources: [] }
  }

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
  let workingProduct = initial
  let workingState = initialState

  if (!workingState.hasCollection) {
    const inferredSlug = inferCollectionSlugFromTitle(workingProduct.title)
    if (inferredSlug) {
      await assignInferredCollection(workingProduct.id, inferredSlug)
      filled.push('collection')
      sources.push('inferred:title')
      const reloaded = await load()
      if (reloaded) {
        workingProduct = reloaded
        workingState = buildState(reloaded)
      }
    }
  }

  await backfillMissingImages(workingProduct, workingState, firecrawlBudget, filled, sources)
  const afterImageBackfill = await load()
  if (afterImageBackfill) {
    workingProduct = afterImageBackfill
    workingState = buildState(afterImageBackfill)
  }

  await backfillFromIrelandShopify(workingProduct, workingState, filled, sources)
  const afterIrelandBackfill = await load()
  if (afterIrelandBackfill) {
    workingProduct = afterIrelandBackfill
    workingState = buildState(afterIrelandBackfill)
  }

  await backfillMissingAttributes(workingProduct, workingState, firecrawlBudget, filled, sources)
  await backfillFromWarehouses(workingProduct, firecrawlBudget, filled, sources)

  if (workingState.isLaptop) {
    const familyResult = await autoLinkVariantFamily(workingProduct.id, triggeredBy)
    if (familyResult.linked) {
      filled.push('variant_family')
      sources.push(`family:${familyResult.sourceSku ?? 'matched'}`)
    }
  }

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
