import FirecrawlApp from '@mendable/firecrawl-js'
import { db } from '@/lib/db/client'
import { products, productImages, platformMappings, warehouseStock } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import { getR2Bucket, getR2PublicUrl } from '@/lib/r2/client'
import { scrapeProductDetail } from '@/lib/connectors/acer-scraper'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { Platform, TriggeredBy, ImageInput } from '@/types/platform'

const STOCK_WAREHOUSES = ['ireland', 'acer_store'] as const

export interface ChannelSyncResult {
  platform: Platform
  statusUpdated: number
  newProductsCreated: number
  newSkus: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// syncChannelAvailability — main entry point
// ---------------------------------------------------------------------------

export async function syncChannelAvailability(
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<ChannelSyncResult[]> {
  const masterStock = await getMasterStockMap()
  const results: ChannelSyncResult[] = []
  for (const platform of platforms) {
    results.push(await syncPlatform(platform, masterStock, triggeredBy))
  }
  return results
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface StockEntry {
  sku: string
  quantity: number
  sourceUrl?: string
  sourceName?: string
}

async function getMasterStockMap(): Promise<Map<string, StockEntry>> {
  const rows = await db.query.warehouseStock.findMany({
    where: inArray(warehouseStock.warehouseId, [...STOCK_WAREHOUSES]),
  })
  const map = new Map<string, StockEntry>()
  for (const row of rows) {
    const entry = map.get(row.productId)
    if (entry) {
      entry.quantity += row.quantity
      entry.sourceUrl  ??= row.sourceUrl  ?? undefined
      entry.sourceName ??= row.sourceName ?? undefined
    } else {
      map.set(row.productId, {
        sku:        row.productId,
        quantity:   row.quantity,
        sourceUrl:  row.sourceUrl  ?? undefined,
        sourceName: row.sourceName ?? undefined,
      })
    }
  }
  return map
}

async function syncPlatform(
  platform: Platform,
  masterStock: Map<string, StockEntry>,
  triggeredBy: TriggeredBy
): Promise<ChannelSyncResult> {
  const connector = getConnector(platform)
  const mappings  = await db.query.platformMappings.findMany({
    where: eq(platformMappings.platform, platform),
  })
  const mappedSkus = new Map(mappings.map(m => [m.productId, m.platformId]))

  const errors: string[] = []
  let statusUpdated = 0

  // Update status for already-mapped products
  for (const [sku, entry] of masterStock) {
    const platformId = mappedSkus.get(sku)
    if (!platformId) continue
    const status = entry.quantity > 0 ? 'active' : 'archived'
    try {
      await connector.toggleStatus(platformId, status)
      statusUpdated++
    } catch (err) {
      errors.push(`${sku} status: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  // Find SKUs that are in stock but have no listing on this platform
  const missing = [...masterStock.values()].filter(
    e => e.quantity > 0 && !mappedSkus.has(e.sku) && e.sourceUrl
  )

  const newSkus = await createMissingProducts(missing, platform, triggeredBy, errors)

  await logOperation({
    platform,
    action: 'sync_channel_availability',
    status: errors.length === 0 ? 'success' : 'error',
    message: `updated=${statusUpdated} created=${newSkus.length} errors=${errors.length}`,
    triggeredBy,
  })

  return { platform, statusUpdated, newProductsCreated: newSkus.length, newSkus, errors }
}

async function createMissingProducts(
  entries: StockEntry[],
  platform: Platform,
  triggeredBy: TriggeredBy,
  errors: string[]
): Promise<string[]> {
  if (entries.length === 0) return []

  const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
  const bucket    = getR2Bucket()
  const publicUrl = getR2PublicUrl()
  const connector = getConnector(platform)
  const createdSkus: string[] = []

  for (const entry of entries) {
    try {
      const detail = await scrapeProductDetail(firecrawl, entry.sourceUrl!)
      const imageInputs = await fetchAndUploadImages(detail.imageUrls, entry.sku, bucket, publicUrl)

      // Update product record with scraped detail
      await db.update(products)
        .set({ title: entry.sourceName ?? entry.sku, description: detail.description,
               productType: detail.category, pendingReview: 1 })
        .where(eq(products.id, entry.sku))

      // Persist images in D1
      await db.delete(productImages).where(eq(productImages.productId, entry.sku))
      for (const [i, img] of imageInputs.entries()) {
        if (img.type !== 'url') continue
        await db.insert(productImages).values({
          id: generateId(), productId: entry.sku, url: img.url, position: i, alt: null,
        })
      }

      // Create on platform
      const platformId = await connector.createProduct({
        title: entry.sourceName ?? entry.sku, description: detail.description,
        status: 'active', vendor: 'Acer', productType: detail.category, taxCode: null,
        price: detail.price, compareAt: detail.promoPrice,
      })
      await connector.setImages(platformId, imageInputs)

      await db.insert(platformMappings).values({
        productId: entry.sku, platform, platformId, syncStatus: 'synced',
        lastSynced: new Date().toISOString(),
      })

      await logOperation({ productId: entry.sku, platform,
        action: 'create_missing_product', status: 'success', triggeredBy })
      createdSkus.push(entry.sku)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${entry.sku} create: ${msg}`)
      await logOperation({ productId: entry.sku, platform,
        action: 'create_missing_product', status: 'error', message: msg, triggeredBy })
    }
  }

  return createdSkus
}

async function fetchAndUploadImages(
  urls: string[],
  sku: string,
  bucket: R2Bucket,
  publicUrl: string
): Promise<ImageInput[]> {
  const inputs: ImageInput[] = []
  for (const url of urls.slice(0, 5)) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buffer   = await res.arrayBuffer()
      const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
      const ext      = mimeType.split('/')[1]?.split(';')[0] ?? 'jpg'
      const key      = `products/${sku}/${generateId()}.${ext}`
      await bucket.put(key, buffer, { httpMetadata: { contentType: mimeType } })
      inputs.push({ type: 'url', url: `${publicUrl}/${key}` })
    } catch {
      // skip images that fail to fetch
    }
  }
  return inputs
}
