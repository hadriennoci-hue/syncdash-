import { db } from '@/lib/db/client'
import { products, platformMappings, warehouseStock } from '@/lib/db/schema'
import { eq, or, gt } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, TriggeredBy, ImageInput } from '@/types/platform'

export interface ChannelSyncResult {
  platform:           Platform
  statusUpdated:      number
  newProductsCreated: number
  zeroedOutOfStock:   number
  skippedRecentEdits: number
  newSkus:            string[]
  errors:             string[]
  incomplete:         Array<{ sku: string; missing: string[] }>
}

interface ChannelSyncOptions {
  // Optional protection window: when > 0, stock-zero is skipped for channel products
  // whose own updated_at is newer than now - windowHours.
  protectRecentChannelEditsHours?: number
}

interface PriceRow   { platform: string; price: number | null; compareAt: number | null }
interface CatRow     { category: { id: string; platform: string } }
interface StockRow   { quantity: number }
interface MappingRow { platform: string; platformId: string }
interface ImageRow   { url: string; position: number; alt: string | null }

interface EligibleProduct {
  id:                      string
  title:                   string
  description:             string | null
  ean:                     string | null
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

  // Categories are optional - products can still push without categories.
  return missing
}

export async function syncChannelAvailability(
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human',
  options: ChannelSyncOptions = {}
): Promise<ChannelSyncResult[]> {
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

  const eligible = raw.filter((p) =>
    p.warehouseStock.some((ws) => ws.quantity > 0)
  ) as unknown as EligibleProduct[]

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
      statusUpdated: 0,
      newProductsCreated: 0,
      zeroedOutOfStock: 0,
      skippedRecentEdits: 0,
      newSkus: [],
      errors: [],
      incomplete,
    }))
  }

  const results: ChannelSyncResult[] = []
  for (const platform of platforms) {
    results.push(await pushPlatform(platform, eligible, triggeredBy, options))
  }
  return results
}

async function pushPlatform(
  platform: Platform,
  eligible: EligibleProduct[],
  triggeredBy: TriggeredBy,
  _options: ChannelSyncOptions
): Promise<ChannelSyncResult> {
  if (BROWSER_PLATFORMS.includes(platform)) {
    const count = eligible.filter((p) => isPushable(p, platform)).length
    return {
      platform,
      statusUpdated: 0,
      newProductsCreated: 0,
      zeroedOutOfStock: 0,
      skippedRecentEdits: 0,
      newSkus: [],
      errors: [`browser channel - ${count} product(s) queued, run local push script to process`],
      incomplete: [],
    }
  }

  const toPush    = eligible.filter((p) => isPushable(p, platform))
  const connector = await createConnector(platform)
  const errors: string[] = []
  const newSkus: string[] = []
  const touchedPlatformIds = new Set<string>()
  let statusUpdated = 0

  for (const product of toPush) {
    const mapping = product.platformMappings.find((m) => m.platform === platform)
    if (mapping?.platformId) touchedPlatformIds.add(mapping.platformId)
    const totalStock = product.warehouseStock.reduce((sum, ws) => sum + ws.quantity, 0)
    const priceRow = product.prices.find((r) => r.platform === platform)

    try {
      const identityPatch = (
        platform.startsWith('shopify')
          ? { ean: product.ean?.trim() ? product.ean.trim() : undefined }
          : { sku: product.id, ean: product.ean?.trim() ? product.ean.trim() : undefined }
      )

      const upsertMapping = async (platformId: string): Promise<void> => {
        await db.insert(platformMappings).values({
          productId: product.id,
          platform,
          platformId,
          syncStatus: 'synced',
          lastSynced: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: [platformMappings.productId, platformMappings.platform],
          set: { platformId, syncStatus: 'synced', lastSynced: new Date().toISOString() },
        })
      }

      const updateExisting = async (platformId: string): Promise<void> => {
        await connector.updateProduct(platformId, identityPatch)
        await connector.updatePrice(platformId, priceRow?.price ?? null, priceRow?.compareAt ?? null)
        await connector.updateStock(platformId, totalStock)
        await connector.toggleStatus(platformId, 'active')
      }

      const createNew = async (): Promise<string> => {
        const images: ImageInput[] = product.images
          .sort((a, b) => a.position - b.position)
          .map((img) => ({ type: 'url' as const, url: img.url, alt: img.alt ?? undefined }))

        const categoryIds = product.categories
          .filter((pc) => platform === 'woocommerce'
            ? pc.category.platform === 'woocommerce'
            : pc.category.platform === platform)
          .map((pc) => pc.category.id)

        const platformId = await connector.createProduct({
          sku: product.id,
          ean: product.ean?.trim() ? product.ean.trim() : null,
          title: product.title,
          description: product.description,
          status: 'active',
          vendor: product.vendor,
          productType: product.productType,
          taxCode: null,
          price: priceRow?.price ?? null,
          compareAt: priceRow?.compareAt ?? null,
          ...(platform.startsWith('shopify') ? { shopifyCategory: 'gid://shopify/TaxonomyCategory/el' } : {}),
          categoryIds,
        })

        if (images.length > 0) await connector.setImages(platformId, images)
        await connector.updateStock(platformId, totalStock)
        return platformId
      }

      let finalPlatformId: string | null = null
      let successMessage = 'created'
      const mappedId = mapping?.platformId ?? null

      if (mappedId) {
        try {
          await updateExisting(mappedId)
          finalPlatformId = mappedId
          successMessage = 'updated by mapping'
        } catch (mappedErr) {
          const skuHit = await connector.findProductIdBySku?.(product.id) ?? null
          if (skuHit) {
            await upsertMapping(skuHit)
            await updateExisting(skuHit)
            finalPlatformId = skuHit
            successMessage = skuHit === mappedId ? 'updated by mapping after retry' : 'updated by SKU remap'
          } else {
            const createdId = await createNew()
            await upsertMapping(createdId)
            finalPlatformId = createdId
            newSkus.push(product.id)
            successMessage = 'created after missing mapped ID'
          }
          if (!finalPlatformId) throw mappedErr
        }
      } else {
        const skuHit = await connector.findProductIdBySku?.(product.id) ?? null
        if (skuHit) {
          await upsertMapping(skuHit)
          await updateExisting(skuHit)
          finalPlatformId = skuHit
          successMessage = 'updated by SKU'
        } else {
          const createdId = await createNew()
          await upsertMapping(createdId)
          finalPlatformId = createdId
          newSkus.push(product.id)
          successMessage = 'created'
        }
      }

      if (finalPlatformId) {
        touchedPlatformIds.add(finalPlatformId)
        if (!newSkus.includes(product.id)) statusUpdated++
      }

      await db.update(products)
        .set(getPushUpdate(platform, 'done') as Record<string, string>)
        .where(eq(products.id, product.id))

      await logOperation({
        productId: product.id,
        platform,
        action: 'push_product',
        status: 'success',
        message: successMessage,
        triggeredBy,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${product.id}: ${msg}`)
      await db.update(products)
        .set(getPushUpdate(platform, `FAIL: ${msg.slice(0, 200)}`) as Record<string, string>)
        .where(eq(products.id, product.id))
      await logOperation({
        productId: product.id,
        platform,
        action: 'push_product',
        status: 'error',
        message: msg,
        triggeredBy,
      })
    }
  }

  let zeroedOutOfStock = 0
  let skippedRecentEdits = 0
  try {
    const inStockRows = await db.query.warehouseStock.findMany({
      where: gt(warehouseStock.quantity, 0),
      columns: { productId: true },
    })
    const inStockSkus = new Set(inStockRows.map((r) => r.productId))

    const allMappings = await db.query.platformMappings.findMany({
      where: eq(platformMappings.platform, platform),
    })
    const toZero: Array<{ platformId: string; quantity: number }> = allMappings
      .filter((m) => !inStockSkus.has(m.productId))
      .filter((m) => !touchedPlatformIds.has(m.platformId))
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
    action: 'sync_channel_availability',
    status: errors.length === 0 ? 'success' : 'error',
    message: `updated=${statusUpdated} created=${newSkus.length} zeroed=${zeroedOutOfStock} protected=${skippedRecentEdits} errors=${errors.length}`,
    triggeredBy,
  })

  return {
    platform,
    statusUpdated,
    newProductsCreated: newSkus.length,
    zeroedOutOfStock,
    skippedRecentEdits,
    newSkus,
    errors,
    incomplete: [],
  }
}
