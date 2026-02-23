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

// Maps platform → the products column that tracks push status for that channel
function getPushFilter(platform: Platform) {
  switch (platform) {
    case 'woocommerce':        return eq(products.pushedWoocommerce, '2push')
    case 'shopify_komputerzz': return eq(products.pushedShopifyKomputerzz, '2push')
    case 'shopify_tiktok':     return eq(products.pushedShopifyTiktok, '2push')
    default:                   return null
  }
}

function getDoneUpdate(platform: Platform): Partial<Record<string, string>> {
  switch (platform) {
    case 'woocommerce':        return { pushedWoocommerce: 'done' }
    case 'shopify_komputerzz': return { pushedShopifyKomputerzz: 'done' }
    case 'shopify_tiktok':     return { pushedShopifyTiktok: 'done' }
    default:                   return {}
  }
}

// ---------------------------------------------------------------------------
// syncChannelAvailability — updates status for already-listed products
//   then pushes products marked '2push' for each channel
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

  // 1. Update active/archived status for products already listed on this channel
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

  // 2. Push products explicitly marked '2push' for this channel
  const pushFilter = getPushFilter(platform)
  const newSkus: string[] = []

  if (pushFilter) {
    const toPush = await db.query.products.findMany({ where: pushFilter })

    for (const product of toPush) {
      // Skip if already mapped (listed) on this channel
      if (mappedSkus.has(product.id)) {
        await db.update(products)
          .set(getDoneUpdate(platform) as Record<string, string>)
          .where(eq(products.id, product.id))
        newSkus.push(product.id)
        continue
      }

      const stockEntry = masterStock.get(product.id)
      try {
        await pushProductToChannel(product, stockEntry, platform, connector, triggeredBy)
        await db.update(products)
          .set(getDoneUpdate(platform) as Record<string, string>)
          .where(eq(products.id, product.id))
        newSkus.push(product.id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`${product.id}: ${msg}`)
        await logOperation({ productId: product.id, platform,
          action: 'push_product', status: 'error', message: msg, triggeredBy })
      }
    }
  }

  await logOperation({
    platform,
    action: 'sync_channel_availability',
    status: errors.length === 0 ? 'success' : 'error',
    message: `status_updated=${statusUpdated} pushed=${newSkus.length} errors=${errors.length}`,
    triggeredBy,
  })

  return { platform, statusUpdated, newProductsCreated: newSkus.length, newSkus, errors }
}

async function pushProductToChannel(
  product: { id: string; title: string; description: string | null; productType: string | null },
  stockEntry: StockEntry | undefined,
  platform: Platform,
  connector: ReturnType<typeof getConnector>,
  triggeredBy: TriggeredBy
): Promise<void> {
  let description = product.description
  let productType = product.productType
  const imageInputs: ImageInput[] = []

  // If we have a sourceUrl (ACER Store), scrape for enriched data
  if (stockEntry?.sourceUrl) {
    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
    const bucket    = getR2Bucket()
    const publicUrl = getR2PublicUrl()

    const detail = await scrapeProductDetail(firecrawl, stockEntry.sourceUrl)
    description  = detail.description
    productType  = detail.category

    await db.update(products)
      .set({ description: detail.description, productType: detail.category })
      .where(eq(products.id, product.id))

    const uploaded = await fetchAndUploadImages(detail.imageUrls, product.id, bucket, publicUrl)
    imageInputs.push(...uploaded)

    await db.delete(productImages).where(eq(productImages.productId, product.id))
    for (const [i, img] of imageInputs.entries()) {
      if (img.type !== 'url') continue
      await db.insert(productImages).values({
        id: generateId(), productId: product.id, url: img.url, position: i, alt: null,
      })
    }
  }

  const platformId = await connector.createProduct({
    title: product.title, description, status: 'active',
    vendor: 'Acer', productType, taxCode: null,
    price: null, compareAt: null,
  })

  if (imageInputs.length > 0) await connector.setImages(platformId, imageInputs)

  await db.insert(platformMappings).values({
    productId: product.id, platform, platformId, syncStatus: 'synced',
    lastSynced: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [platformMappings.productId, platformMappings.platform],
    set: { platformId, syncStatus: 'synced', lastSynced: new Date().toISOString() },
  })

  await logOperation({ productId: product.id, platform,
    action: 'push_product', status: 'success', triggeredBy })
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
