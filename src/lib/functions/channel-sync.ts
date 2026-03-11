import { db } from '@/lib/db/client'
import { products, platformMappings, warehouseStock } from '@/lib/db/schema'
import { eq, or, gt } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import type { Platform, TriggeredBy, ImageInput } from '@/types/platform'
import { ATTRIBUTE_OPTIONS } from '@/lib/constants/product-attribute-options'

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
interface CatRow     { category: { id: string; platform: string; name: string; slug: string | null } }
interface StockRow   { quantity: number }
interface MappingRow { platform: string; platformId: string }
interface ImageRow   { url: string; position: number; alt: string | null }

type WooSkuAware = {
  updateProductForSku: (platformId: string, sku: string, data: Partial<import('@/lib/connectors/types').ProductPayload>) => Promise<void>
  updatePriceForSku: (platformId: string, sku: string, price: number | null, compareAt?: number | null) => Promise<void>
  updateStockForSku: (platformId: string, sku: string, quantity: number) => Promise<void>
  toggleStatusForSku: (platformId: string, sku: string, status: 'active' | 'archived') => Promise<void>
  bulkSetStockForSkus: (items: Array<{ platformId: string; sku: string; quantity: number }>) => Promise<void>
}

function isWooSkuAware(connector: unknown): connector is WooSkuAware {
  return !!connector
    && typeof (connector as WooSkuAware).updateProductForSku === 'function'
    && typeof (connector as WooSkuAware).updatePriceForSku === 'function'
    && typeof (connector as WooSkuAware).updateStockForSku === 'function'
    && typeof (connector as WooSkuAware).toggleStatusForSku === 'function'
    && typeof (connector as WooSkuAware).bulkSetStockForSkus === 'function'
}

interface EligibleProduct {
  id:                      string
  title:                   string
  description:             string | null
  ean:                     string | null
  vendor:                  string | null
  productType:             string | null
  pushedCoincart2:       string
  pushedShopifyKomputerzz: string
  pushedShopifyTiktok:     string
  pushedEbayIe:            string
  pushedXmrBazaar:         string
  pushedLibreMarket:       string
  images:                  ImageRow[]
  variants:                Array<{
    title: string | null
    sku: string | null
    price: number | null
    compareAtPrice: number | null
    stock: number | null
    optionName1: string | null
    option1: string | null
    optionName2: string | null
    option2: string | null
    optionName3: string | null
    option3: string | null
  }>
  prices:                  PriceRow[]
  metafields:              Array<{ namespace: string; key: string; value: string | null }>
  categories:              CatRow[]
  warehouseStock:          StockRow[]
  platformMappings:        MappingRow[]
}

const BROWSER_PLATFORMS: Platform[] = ['xmr_bazaar', 'libre_market']

function slugifyHandle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function splitAttributeValues(raw: string): string[] {
  return raw
    .split(/[|,;]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function collectProductAttributeValues(
  product: EligibleProduct,
  allowedKeys: Set<string>
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const mf of product.metafields) {
    if (mf.namespace !== 'attributes') continue
    const key = mf.key.trim().toLowerCase()
    if (!allowedKeys.has(key)) continue
    const raw = (mf.value ?? '').trim()
    if (!raw) continue
    const values = splitAttributeValues(raw)
    if (!values.length) continue
    out[key] = Array.from(new Set([...(out[key] ?? []), ...values]))
  }
  return out
}

function detectKomputerzzCollectionTargets(product: EligibleProduct): Array<{ handle: string; type: 'laptops' | 'monitor' }> {
  const targets: Array<{ handle: string; type: 'laptops' | 'monitor' }> = []
  for (const pc of product.categories) {
    if (!pc.category || pc.category.platform !== 'shopify_komputerzz') continue
    const name = normalizeText(pc.category.name ?? '')
    const slug = normalizeText(pc.category.slug ?? '')
    const handle = (pc.category.slug ?? slugifyHandle(pc.category.name)).trim()
    if (!handle) continue
    if (name.includes('laptop') || slug.includes('laptop')) {
      targets.push({ handle, type: 'laptops' })
      continue
    }
    if (
      name.includes('display')
      || name.includes('monitor')
      || name.includes('ecran')
      || slug.includes('display')
      || slug.includes('monitor')
      || slug.includes('ecran')
    ) {
      targets.push({ handle, type: 'monitor' })
    }
  }
  const dedup = new Map<string, { handle: string; type: 'laptops' | 'monitor' }>()
  for (const t of targets) dedup.set(`${t.type}:${t.handle}`, t)
  return Array.from(dedup.values())
}

function detectCollectionTypes(product: EligibleProduct): { isLaptop: boolean; isDisplay: boolean } {
  let isLaptop = false
  let isDisplay = false
  for (const pc of product.categories) {
    if (!pc.category) continue
    const name = normalizeText(pc.category.name ?? '')
    const slug = normalizeText(pc.category.slug ?? '')
    if (name.includes('laptop') || slug.includes('laptop')) isLaptop = true
    if (
      name.includes('display')
      || name.includes('monitor')
      || name.includes('ecran')
      || slug.includes('display')
      || slug.includes('monitor')
      || slug.includes('ecran')
    ) isDisplay = true
  }
  return { isLaptop, isDisplay }
}

function collectCoincartAttributeValues(product: EligibleProduct): Record<string, string[]> {
  const { isLaptop, isDisplay } = detectCollectionTypes(product)
  if (!isLaptop && !isDisplay) return {}

  const allowedKeys = new Set<string>([
    ...(isLaptop ? Object.keys(ATTRIBUTE_OPTIONS.laptops) : []),
    ...(isDisplay ? Object.keys(ATTRIBUTE_OPTIONS.monitor) : []),
  ])
  return collectProductAttributeValues(product, allowedKeys)
}

const SHOPIFY_PRODUCT_ATTRIBUTE_KEY_MAP: Record<string, string> = {
  brand: 'brand',
  processor: 'processor',
  screen_size: 'screen_size',
  resolution: 'resolution',
  screen_resolution: 'max_resolution',
  gpu: 'graphic_card',
  ram: 'ram_memory',
  storage: 'ssd_size',
  category: 'usage',
}

function collectShopifyProductMetafieldsFromAttributes(product: EligibleProduct): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const mf of product.metafields) {
    if (mf.namespace !== 'attributes') continue
    const sourceKey = mf.key.trim().toLowerCase()
    const targetKey = SHOPIFY_PRODUCT_ATTRIBUTE_KEY_MAP[sourceKey]
    if (!targetKey) continue
    const raw = (mf.value ?? '').trim()
    if (!raw) continue
    const values = splitAttributeValues(raw)
    if (!values.length) continue
    out[targetKey] = Array.from(new Set([...(out[targetKey] ?? []), ...values]))
  }
  return out
}

function isPushable(p: EligibleProduct, platform: Platform): boolean {
  if (platform === 'coincart2')        return p.pushedCoincart2 === '2push'
  if (platform === 'shopify_komputerzz') return p.pushedShopifyKomputerzz === '2push'
  if (platform === 'shopify_tiktok')     return p.pushedShopifyTiktok === '2push'
  if (platform === 'ebay_ie')            return p.pushedEbayIe === '2push'
  if (platform === 'xmr_bazaar')         return p.pushedXmrBazaar === '2push'
  if (platform === 'libre_market')       return p.pushedLibreMarket === '2push'
  return false
}

function getPushUpdate(platform: Platform, value: string): Record<string, string> {
  if (platform === 'coincart2')        return { pushedCoincart2: value }
  if (platform === 'shopify_komputerzz') return { pushedShopifyKomputerzz: value }
  if (platform === 'shopify_tiktok')     return { pushedShopifyTiktok: value }
  if (platform === 'ebay_ie')            return { pushedEbayIe: value }
  if (platform === 'xmr_bazaar')         return { pushedXmrBazaar: value }
  if (platform === 'libre_market')       return { pushedLibreMarket: value }
  return {}
}

function checkCompleteness(p: EligibleProduct, platform: Platform): string[] {
  const missing: string[] = []

  if (!p.title || p.title === p.id) missing.push('title')
  if (!p.description?.trim())        missing.push('description')
  if (p.images.length < 2)           missing.push(`images (${p.images.length}/2)`)

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
      eq(products.pushedCoincart2, '2push'),
      eq(products.pushedShopifyKomputerzz, '2push'),
      eq(products.pushedShopifyTiktok, '2push'),
      eq(products.pushedEbayIe, '2push'),
      eq(products.pushedXmrBazaar, '2push'),
      eq(products.pushedLibreMarket, '2push'),
    ),
    with: {
      images:           true,
      variants:         true,
      prices:           true,
      metafields:       true,
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

  const buildVariantPayloads = (product: EligibleProduct, fallbackPrice: number | null, fallbackCompareAt: number | null) => {
    if (!product.variants.length) return undefined
    return product.variants.map((v) => ({
      title: v.title ?? null,
      sku: v.sku ?? null,
      price: v.price ?? fallbackPrice ?? null,
      compareAt: v.compareAtPrice ?? fallbackCompareAt ?? null,
      stock: Number.isFinite(v.stock as number) ? Number(v.stock) : 0,
      optionName1: v.optionName1 ?? null,
      option1: v.option1 ?? null,
      optionName2: v.optionName2 ?? null,
      option2: v.option2 ?? null,
      optionName3: v.optionName3 ?? null,
      option3: v.option3 ?? null,
    }))
  }

  for (const product of toPush) {
    const mapping = product.platformMappings.find((m) => m.platform === platform)
    if (mapping?.platformId) touchedPlatformIds.add(mapping.platformId)
    const totalStock = product.warehouseStock.reduce((sum, ws) => sum + ws.quantity, 0)
    const priceRow = product.prices.find((r) => r.platform === platform)
    const coincartAttributeValues = platform === 'coincart2'
      ? collectCoincartAttributeValues(product)
      : {}

    try {
      const identityPatch = (
        platform.startsWith('shopify')
          ? { ean: product.ean?.trim() ? product.ean.trim() : undefined }
          : {
              sku: product.id,
              ean: product.ean?.trim() ? product.ean.trim() : undefined,
              collections: product.categories
                .filter((pc) => pc.category.platform !== 'coincart2')
                .map((pc) => ({
                  title: pc.category.name,
                  handle: (pc.category.slug ?? slugifyHandle(pc.category.name)).trim(),
                }))
                .filter((c) => c.title.trim().length > 0)
                .map((c) => ({ name: c.title, handle: c.handle })),
              ...(platform === 'coincart2' && Object.keys(coincartAttributeValues).length > 0
                ? { attributeValues: coincartAttributeValues }
                : {}),
            }
      )
      const variantPayloads = buildVariantPayloads(product, priceRow?.price ?? null, priceRow?.compareAt ?? null)
      const payloadWithVariants = {
        ...identityPatch,
        ...(variantPayloads?.length ? { variants: variantPayloads, replaceVariants: true } : {}),
      }

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
        if (platform === 'coincart2' && isWooSkuAware(connector)) {
          if (variantPayloads?.length) {
            await connector.updateProduct(platformId, payloadWithVariants)
            await connector.toggleStatus(platformId, 'active')
          } else {
            await connector.updateProductForSku(platformId, product.id, identityPatch)
            await connector.updatePriceForSku(platformId, product.id, priceRow?.price ?? null, priceRow?.compareAt ?? null)
            await connector.updateStockForSku(platformId, product.id, totalStock)
            await connector.toggleStatusForSku(platformId, product.id, 'active')
          }
        } else {
          await connector.updateProduct(platformId, payloadWithVariants)
          await connector.updatePrice(platformId, priceRow?.price ?? null, priceRow?.compareAt ?? null)
          await connector.updateStock(platformId, totalStock)
          await connector.toggleStatus(platformId, 'active')
        }
      }

      const createNew = async (): Promise<string> => {
        const images: ImageInput[] = product.images
          .sort((a, b) => a.position - b.position)
          .map((img) => ({ type: 'url' as const, url: img.url, alt: img.alt ?? undefined }))

        const categoryIds = product.categories
          .filter((pc) => platform === 'coincart2'
            ? pc.category.platform !== 'coincart2'
            : pc.category.platform === platform)
          .map((pc) => pc.category.id)
        const collections = product.categories
          .filter((pc) => pc.category.platform !== 'coincart2')
          .map((pc) => ({
            name: pc.category.name,
            handle: (pc.category.slug ?? slugifyHandle(pc.category.name)).trim(),
          }))
          .filter((c) => c.name.trim().length > 0)

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
          ...(variantPayloads?.length ? { variants: variantPayloads, replaceVariants: true } : {}),
          ...(platform.startsWith('shopify') ? { shopifyCategory: 'gid://shopify/TaxonomyCategory/el' } : {}),
          categoryIds,
          collections,
          ...(platform === 'coincart2' && Object.keys(coincartAttributeValues).length > 0
            ? { attributeValues: coincartAttributeValues }
            : {}),
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

      // Shopify: when pushing to a non-TikTok Shopify channel, sync TikTok collections by title/handle.
      if (platform.startsWith('shopify') && platform !== 'shopify_tiktok') {
        const tikCats = product.categories
          .filter((pc) => pc.category.platform === 'shopify_tiktok')
          .map((pc) => ({
            title: pc.category.name,
            handle: (pc.category.slug ?? slugifyHandle(pc.category.name)).trim(),
          }))
          .filter((c) => c.handle.length > 0)
        if (tikCats.length > 0 && typeof (connector as any).syncCollectionsToProduct === 'function') {
          await (connector as any).syncCollectionsToProduct(finalPlatformId!, tikCats)
        }
      }

      if (platform === 'shopify_komputerzz' && typeof (connector as any).syncProductAttributeMetafields === 'function' && finalPlatformId) {
        const productMetafields = collectShopifyProductMetafieldsFromAttributes(product)
        if (Object.keys(productMetafields).length > 0) {
          await (connector as any).syncProductAttributeMetafields(finalPlatformId, productMetafields)
        }
      }

      if (platform === 'shopify_komputerzz' && typeof (connector as any).syncCollectionAttributeValues === 'function') {
        const targets = detectKomputerzzCollectionTargets(product)
        const laptopKeys = new Set(Object.keys(ATTRIBUTE_OPTIONS.laptops))
        const displayKeys = new Set(Object.keys(ATTRIBUTE_OPTIONS.monitor))
        for (const target of targets) {
          const attrs = collectProductAttributeValues(
            product,
            target.type === 'laptops' ? laptopKeys : displayKeys
          )
          if (Object.keys(attrs).length === 0) continue
          await (connector as any).syncCollectionAttributeValues(target.handle, attrs)
        }
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
  const skippedRecentEdits = 0
  try {
    const inStockRows = await db.query.warehouseStock.findMany({
      where: gt(warehouseStock.quantity, 0),
      columns: { productId: true },
    })
    const inStockSkus = new Set(inStockRows.map((r) => r.productId))

    const allMappings = await db.query.platformMappings.findMany({
      where: eq(platformMappings.platform, platform),
    })
    const toZero = allMappings
      .filter((m) => !inStockSkus.has(m.productId))
      .filter((m) => !touchedPlatformIds.has(m.platformId))
      .map((m) => ({ platformId: m.platformId, sku: m.productId, quantity: 0 }))

    if (toZero.length > 0) {
      if (platform === 'coincart2' && isWooSkuAware(connector)) {
        await connector.bulkSetStockForSkus(toZero)
      } else {
        await connector.bulkSetStock(toZero.map(({ platformId, quantity }) => ({ platformId, quantity })))
      }
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

