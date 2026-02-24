import { db } from '@/lib/db/client'
import { products, platformMappings } from '@/lib/db/schema'
import { eq, or } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, TriggeredBy, ImageInput } from '@/types/platform'

export interface ChannelSyncResult {
  platform:           Platform
  statusUpdated:      number
  newProductsCreated: number
  zeroedOutOfStock:   number
  newSkus:            string[]
  errors:             string[]
  incomplete:         Array<{ sku: string; missing: string[] }>
}

// ---------------------------------------------------------------------------
// Internal types (shaped from Drizzle relation query)
// ---------------------------------------------------------------------------

interface PriceRow   { platform: string; price: number | null; compareAt: number | null }
interface CatRow     { category: { id: string; platform: string } }
interface StockRow   { quantity: number }
interface MappingRow { platform: string; platformId: string }
interface ImageRow   { url: string; position: number; alt: string | null }

interface EligibleProduct {
  id:                      string
  title:                   string
  description:             string | null
  vendor:                  string | null
  productType:             string | null
  pushedWoocommerce:       string
  pushedShopifyKomputerzz: string
  pushedShopifyTiktok:     string
  pushedXmrBazaar:         string
  pushedLibreMarket:       string
  images:                  ImageRow[]
  prices:                  PriceRow[]
  categories:              CatRow[]
  warehouseStock:          StockRow[]
  platformMappings:        MappingRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Platforms that use browser automation (Playwright) rather than a REST connector.
// These are handled separately — cannot run inside Cloudflare Workers.
const BROWSER_PLATFORMS: Platform[] = ['xmr_bazaar', 'libre_market']

function isPushable(p: EligibleProduct, platform: Platform): boolean {
  if (platform === 'woocommerce')        return p.pushedWoocommerce === '2push'
  if (platform === 'shopify_komputerzz') return p.pushedShopifyKomputerzz === '2push'
  if (platform === 'shopify_tiktok')     return p.pushedShopifyTiktok === '2push'
  if (platform === 'xmr_bazaar')         return p.pushedXmrBazaar === '2push'
  if (platform === 'libre_market')       return p.pushedLibreMarket === '2push'
  return false
}

function getPushUpdate(platform: Platform, value: string): Record<string, string> {
  if (platform === 'woocommerce')        return { pushedWoocommerce: value }
  if (platform === 'shopify_komputerzz') return { pushedShopifyKomputerzz: value }
  if (platform === 'shopify_tiktok')     return { pushedShopifyTiktok: value }
  if (platform === 'xmr_bazaar')         return { pushedXmrBazaar: value }
  if (platform === 'libre_market')       return { pushedLibreMarket: value }
  return {}
}

function checkCompleteness(p: EligibleProduct, platform: Platform): string[] {
  const missing: string[] = []

  if (!p.title || p.title === p.id) missing.push('title')
  if (!p.description?.trim())        missing.push('description')
  if (p.images.length < 3)           missing.push(`images (${p.images.length}/3)`)

  const price = p.prices.find((r) => r.platform === platform)
  if (!price?.price)                 missing.push(`price (${platform})`)

  if (platform === 'woocommerce') {
    if (!p.categories.some((pc) => pc.category.platform === 'woocommerce'))
      missing.push('woocommerce category')
  } else if (platform.startsWith('shopify')) {
    if (!p.categories.some((pc) => pc.category.platform === platform))
      missing.push(`collection (${platform})`)
  }

  return missing
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function syncChannelAvailability(
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<ChannelSyncResult[]> {
  // Load all 2push candidates with full context
  const raw = await db.query.products.findMany({
    where: or(
      eq(products.pushedWoocommerce, '2push'),
      eq(products.pushedShopifyKomputerzz, '2push'),
      eq(products.pushedShopifyTiktok, '2push'),
      eq(products.pushedXmrBazaar, '2push'),
      eq(products.pushedLibreMarket, '2push'),
    ),
    with: {
      images:           true,
      prices:           true,
      categories:       { with: { category: true } },
      warehouseStock:   true,
      platformMappings: true,
    },
  })

  // Only products with stock > 0 in at least one warehouse
  const eligible = raw.filter((p) =>
    p.warehouseStock.some((ws) => ws.quantity > 0)
  ) as unknown as EligibleProduct[]

  // Completeness check across all platforms — aggregate by SKU, abort if any fail
  const incompleteMap = new Map<string, string[]>()
  for (const platform of platforms) {
    for (const product of eligible.filter((p) => isPushable(p, platform))) {
      const missing = checkCompleteness(product, platform)
      if (missing.length > 0) {
        const prev = incompleteMap.get(product.id) ?? []
        incompleteMap.set(product.id, [...new Set([...prev, ...missing])])
      }
    }
  }

  if (incompleteMap.size > 0) {
    const incomplete = Array.from(incompleteMap.entries()).map(([sku, missing]) => ({ sku, missing }))
    return platforms.map((platform) => ({
      platform,
      statusUpdated: 0, newProductsCreated: 0, zeroedOutOfStock: 0, newSkus: [], errors: [],
      incomplete,
    }))
  }

  // All complete — push each platform
  const results: ChannelSyncResult[] = []
  for (const platform of platforms) {
    results.push(await pushPlatform(platform, eligible, triggeredBy))
  }
  return results
}

// ---------------------------------------------------------------------------
// Push one platform
// ---------------------------------------------------------------------------

async function pushPlatform(
  platform: Platform,
  eligible: EligibleProduct[],
  triggeredBy: TriggeredBy
): Promise<ChannelSyncResult> {
  // Browser channels require local Playwright automation — cannot run in CF Workers.
  // Use the local push scripts (scripts/push-browser-channels.ts) instead.
  if (BROWSER_PLATFORMS.includes(platform)) {
    const count = eligible.filter((p) => isPushable(p, platform)).length
    return {
      platform,
      statusUpdated: 0, newProductsCreated: 0, zeroedOutOfStock: 0, newSkus: [],
      errors: [`browser channel — ${count} product(s) queued, run local push script to process`],
      incomplete: [],
    }
  }

  const toPush    = eligible.filter((p) => isPushable(p, platform))
  const connector = getConnector(platform)
  const errors: string[] = []
  const newSkus:  string[] = []
  let statusUpdated = 0

  for (const product of toPush) {
    const mapping    = product.platformMappings.find((m) => m.platform === platform)
    const totalStock = product.warehouseStock.reduce((sum, ws) => sum + ws.quantity, 0)
    const priceRow   = product.prices.find((r) => r.platform === platform)

    try {
      if (mapping) {
        // Already listed — update price, stock, ensure published
        await connector.updatePrice(mapping.platformId, priceRow?.price ?? null, priceRow?.compareAt ?? null)
        await connector.updateStock(mapping.platformId, totalStock)
        await connector.toggleStatus(mapping.platformId, 'active')
        statusUpdated++
      } else {
        // New product — create with full data
        const images: ImageInput[] = product.images
          .sort((a, b) => a.position - b.position)
          .map((img) => ({ type: 'url' as const, url: img.url, alt: img.alt ?? undefined }))

        const categoryIds = product.categories
          .filter((pc) => platform === 'woocommerce'
            ? pc.category.platform === 'woocommerce'
            : pc.category.platform === platform)
          .map((pc) => pc.category.id)

        const platformId = await connector.createProduct({
          title:       product.title,
          description: product.description,
          status:      'active',
          vendor:      product.vendor,
          productType: product.productType,
          taxCode:     null,
          price:       priceRow?.price ?? null,
          compareAt:   priceRow?.compareAt ?? null,
          ...(platform.startsWith('shopify') ? { shopifyCategory: 'gid://shopify/TaxonomyCategory/el' } : {}),
          categoryIds,
        })

        if (images.length > 0) await connector.setImages(platformId, images)
        await connector.updateStock(platformId, totalStock)

        await db.insert(platformMappings).values({
          productId: product.id, platform, platformId, syncStatus: 'synced',
          lastSynced: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: [platformMappings.productId, platformMappings.platform],
          set: { platformId, syncStatus: 'synced', lastSynced: new Date().toISOString() },
        })

        newSkus.push(product.id)
      }

      await db.update(products)
        .set(getPushUpdate(platform, 'done') as Record<string, string>)
        .where(eq(products.id, product.id))

      await logOperation({
        productId: product.id, platform,
        action: 'push_product', status: 'success',
        message: mapping ? 'updated price/stock' : 'created',
        triggeredBy,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${product.id}: ${msg}`)
      await db.update(products)
        .set(getPushUpdate(platform, `FAIL: ${msg.slice(0, 200)}`) as Record<string, string>)
        .where(eq(products.id, product.id))
      await logOperation({ productId: product.id, platform,
        action: 'push_product', status: 'error', message: msg, triggeredBy })
    }
  }

  // Zero out products that are no longer in stock in any Wizhard warehouse.
  // Uses platform-native batch APIs to minimise API calls.
  let zeroedOutOfStock = 0
  try {
    const allMappings  = await db.query.platformMappings.findMany({
      where: eq(platformMappings.platform, platform),
    })
    const eligibleSkus = new Set(eligible.map((p) => p.id))
    const toZero = allMappings
      .filter((m) => !eligibleSkus.has(m.productId))
      .map((m) => ({ platformId: m.platformId, quantity: 0 }))

    if (toZero.length > 0) {
      await connector.bulkSetStock(toZero)
      zeroedOutOfStock = toZero.length
    }
  } catch (err) {
    errors.push(`bulk-zero: ${err instanceof Error ? err.message : 'error'}`)
  }

  await logOperation({
    platform,
    action:  'sync_channel_availability',
    status:  errors.length === 0 ? 'success' : 'error',
    message: `updated=${statusUpdated} created=${newSkus.length} zeroed=${zeroedOutOfStock} errors=${errors.length}`,
    triggeredBy,
  })

  return { platform, statusUpdated, newProductsCreated: newSkus.length, zeroedOutOfStock, newSkus, errors, incomplete: [] }
}
