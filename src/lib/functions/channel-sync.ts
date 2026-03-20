import { db } from '@/lib/db/client'
import { products, platformMappings, warehouseStock } from '@/lib/db/schema'
import { eq, or, gt } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import { refreshShopifyToken, type ShopifyPlatform } from './tokens'
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
  onPlatformStart?: (info: { platform: Platform; index: number; total: number }) => void | Promise<void>
  onPlatformProgress?: (info: {
    platform: Platform
    index: number
    total: number
    processedTargets: number
    totalTargets: number
    lastProductIds: string[]
    lastStatus: 'success' | 'error'
    message: string
  }) => void | Promise<void>
  onPlatformComplete?: (info: { platform: Platform; index: number; total: number; result: ChannelSyncResult }) => void | Promise<void>
}

interface PriceRow   { platform: string; price: number | null; compareAt: number | null }
interface CatRow     { category: { id: string; platform: string; name: string; slug: string | null } }
interface StockRow   { quantity: number }
interface MappingRow {
  platform: string
  platformId: string
  recordType: 'product' | 'variant'
  variantId: string | null
}
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
  variantGroupId:          string | null
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

interface VariantGroupMember {
  product: EligibleProduct
  priceRow: PriceRow | undefined
  totalStock: number
  keyboardLayout: string | null
  color: string | null
}

interface SinglePushTarget {
  kind: 'single'
  primary: EligibleProduct
}

interface GroupPushTarget {
  kind: 'group'
  groupId: string
  primary: EligibleProduct
  parentSku: string
  members: VariantGroupMember[]
}

type PushTarget = SinglePushTarget | GroupPushTarget

const BROWSER_PLATFORMS: Platform[] = ['xmr_bazaar', 'libre_market']
const GROUPED_VARIANT_PLATFORMS = new Set<Platform>(['coincart2', 'shopify_komputerzz'])
const KEYBOARD_LAYOUT_LABELS: Record<string, string> = {
  be_azerty: 'BE AZERTY',
  fra_azerty: 'FR AZERTY',
  fr_azerty: 'FR AZERTY',
  ger_qwertz: 'DE QWERTZ',
  de_qwertz: 'DE QWERTZ',
  ita_qwerty: 'IT QWERTY',
  it_qwerty: 'IT QWERTY',
  spa_qwerty: 'ES QWERTY',
  es_qwerty: 'ES QWERTY',
  swe_qwerty: 'SE QWERTY',
  se_qwerty: 'SE QWERTY',
  swiss_qwertz: 'CH QWERTZ',
  ch_qwertz: 'CH QWERTZ',
  uk_qwerty: 'UK QWERTY',
  us_qwerty: 'US QWERTY',
  nordic: 'Nordic',
}

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
    if (!pc.category) continue
    const platform = pc.category.platform
    if (platform !== 'shopify_komputerzz' && platform !== 'shopify_tiktok') continue
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
  processor_brand: 'processor_brand',
  processor_model: 'processor_model',
  screen_size: 'screen_size',
  resolution: 'resolution',
  screen_resolution: 'max_resolution',
  gpu: 'graphic_card',
  graphics: 'graphic_card',
  ram: 'ram_memory',
  storage: 'ssd_size',
  storage_type: 'storage_type',
  panel_type: 'panel_type',
  refresh_rate: 'refresh_rate',
  operating_system: 'operating_system',
  touchscreen: 'touchscreen',
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

function checkBaseCompleteness(p: EligibleProduct): string[] {
  const missing: string[] = []

  if (!p.title || p.title === p.id) missing.push('title')
  if (!p.description?.trim())        missing.push('description')
  if (p.images.length < 1)           missing.push(`images (${p.images.length}/1)`)

  return missing
}

function checkCompleteness(p: EligibleProduct, platform: Platform): string[] {
  const missing = checkBaseCompleteness(p)

  const price = p.prices.find((r) => r.platform === platform)
  if (!price?.price)                 missing.push(`price (${platform})`)

  // Categories are optional - products can still push without categories.
  return missing
}

function supportsGroupedVariants(platform: Platform): boolean {
  return GROUPED_VARIANT_PLATFORMS.has(platform)
}

function isShopifyPlatform(platform: Platform): platform is ShopifyPlatform {
  return platform === 'shopify_komputerzz' || platform === 'shopify_tiktok'
}

function isShopifyAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes('Shopify REST error: 401')
    || message.includes('Shopify REST error: 403')
    || message.includes('Shopify GraphQL error: 401')
    || message.includes('Shopify GraphQL error: 403')
    || message.includes('Invalid API key or access token')
    || message.includes('Invalid API key or token')
    || message.includes('Access denied')
    || message.includes('Unauthorized')
    || message.includes('Forbidden')
  )
}

function getProductTotalStock(product: EligibleProduct): number {
  return product.warehouseStock.reduce((sum, ws) => sum + ws.quantity, 0)
}

function getProductPriceRow(product: EligibleProduct, platform: Platform): PriceRow | undefined {
  return product.prices.find((row) => row.platform === platform)
}

function getKeyboardLayout(product: EligibleProduct): string | null {
  const metafield = product.metafields.find((mf) =>
    mf.namespace === 'attributes' && mf.key.trim().toLowerCase() === 'keyboard_layout'
  )
  return metafield?.value?.trim() ?? null
}

function getColor(product: EligibleProduct): string | null {
  const metafield = product.metafields.find((mf) =>
    mf.namespace === 'attributes' && mf.key.trim().toLowerCase() === 'color'
  )
  return metafield?.value?.trim() ?? null
}

function formatKeyboardLayout(layout: string | null, fallbackSku: string): string {
  if (!layout) return fallbackSku
  const normalized = layout.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return KEYBOARD_LAYOUT_LABELS[normalized]
    ?? layout
      .split(/[_-]+/)
      .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
      .join(' ')
}

function buildVariantGroupParentSku(groupId: string): string {
  return `VG-${groupId.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 24)}`
}

function choosePrimaryProduct(productsInGroup: EligibleProduct[]): EligibleProduct {
  return [...productsInGroup].sort((a, b) => {
    const imageDiff = b.images.length - a.images.length
    if (imageDiff !== 0) return imageDiff
    const descDiff = Number(!!b.description?.trim()) - Number(!!a.description?.trim())
    if (descDiff !== 0) return descDiff
    const titleDiff = a.title.length - b.title.length
    if (titleDiff !== 0) return titleDiff
    return a.id.localeCompare(b.id)
  })[0]
}

function buildPushTargets(eligible: EligibleProduct[], platform: Platform): PushTarget[] {
  const pushable = eligible.filter((product) => isPushable(product, platform))
  if (!supportsGroupedVariants(platform)) {
    return pushable.map((product) => ({ kind: 'single', primary: product }))
  }

  const groupMembersById = new Map<string, EligibleProduct[]>()
  for (const product of pushable) {
    if (!product.variantGroupId) continue
    const existing = groupMembersById.get(product.variantGroupId) ?? []
    existing.push(product)
    groupMembersById.set(product.variantGroupId, existing)
  }

  const seenGroups = new Set<string>()
  const targets: PushTarget[] = []

  for (const product of pushable) {
    if (!product.variantGroupId) {
      targets.push({ kind: 'single', primary: product })
      continue
    }

    const members = groupMembersById.get(product.variantGroupId) ?? []
    if (members.length <= 1) {
      targets.push({ kind: 'single', primary: product })
      continue
    }

    if (seenGroups.has(product.variantGroupId)) continue
    seenGroups.add(product.variantGroupId)

    const primary = choosePrimaryProduct(members)
    const preparedMembers = members
      .map((member) => ({
        product: member,
        priceRow: getProductPriceRow(member, platform),
        totalStock: getProductTotalStock(member),
        keyboardLayout: getKeyboardLayout(member),
        color: getColor(member),
      }))
      .sort((a, b) => a.product.id.localeCompare(b.product.id))

    targets.push({
      kind: 'group',
      groupId: product.variantGroupId,
      primary,
      parentSku: buildVariantGroupParentSku(product.variantGroupId),
      members: preparedMembers,
    })
  }

  return targets
}

function checkTargetCompleteness(target: PushTarget, platform: Platform): Array<{ sku: string; missing: string[] }> {
  if (target.kind === 'single') {
    const missing = checkCompleteness(target.primary, platform)
    return missing.length > 0 ? [{ sku: target.primary.id, missing }] : []
  }

  const issues: Array<{ sku: string; missing: string[] }> = []
  const baseMissing = checkBaseCompleteness(target.primary)
  if (baseMissing.length > 0) {
    issues.push({ sku: target.primary.id, missing: baseMissing })
  }
  for (const member of target.members) {
    const missing: string[] = []
    if (!member.priceRow?.price) missing.push(`price (${platform})`)
    if (missing.length > 0) issues.push({ sku: member.product.id, missing })
  }
  return issues
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

  const results: ChannelSyncResult[] = []
  for (let index = 0; index < platforms.length; index++) {
    const platform = platforms[index]
    await options.onPlatformStart?.({ platform, index: index + 1, total: platforms.length })
    const result = await pushPlatform(platform, eligible, triggeredBy, options, { index: index + 1, total: platforms.length })
    results.push(result)
    await options.onPlatformComplete?.({ platform, index: index + 1, total: platforms.length, result })
  }
  return results
}

async function pushPlatform(
  platform: Platform,
  eligible: EligibleProduct[],
  triggeredBy: TriggeredBy,
  options: ChannelSyncOptions,
  progressContext: { index: number; total: number }
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

  const toPush    = buildPushTargets(eligible, platform)
  let connector = await createConnector(platform)
  let shopifyAuthRetried = false
  let processedTargets = 0
  const totalTargets = toPush.length
  const errors: string[] = []
  const newSkus: string[] = []
  const incomplete: Array<{ sku: string; missing: string[] }> = []
  const touchedPlatformIds = new Set<string>()
  let statusUpdated = 0

  const emitProgress = async (
    lastProductIds: string[],
    lastStatus: 'success' | 'error',
    message: string,
  ): Promise<void> => {
    await options.onPlatformProgress?.({
      platform,
      index: progressContext.index,
      total: progressContext.total,
      processedTargets,
      totalTargets,
      lastProductIds,
      lastStatus,
      message,
    })
  }

  const callWithShopifyAuthRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (err) {
      if (!isShopifyPlatform(platform) || shopifyAuthRetried || !isShopifyAuthError(err)) {
        throw err
      }
      shopifyAuthRetried = true
      const tokenResult = await refreshShopifyToken(platform)
      if (!tokenResult.ok) {
        throw new Error(`Shopify auth failed, token refresh also failed: ${tokenResult.error ?? 'unknown error'}`)
      }
      connector = await createConnector(platform)
      return operation()
    }
  }

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

  const collectCategoryIds = (product: EligibleProduct): string[] => (
    product.categories
      .filter((pc) => platform === 'coincart2'
        ? pc.category.platform !== 'coincart2'
        : pc.category.platform === platform)
      .map((pc) => pc.category.id)
  )

  const collectCollections = (product: EligibleProduct): Array<{ name: string; handle: string }> => (
    product.categories
      .filter((pc) => pc.category.platform !== 'coincart2')
      .map((pc) => ({
        name: pc.category.name,
        handle: (pc.category.slug ?? slugifyHandle(pc.category.name)).trim(),
      }))
      .filter((c) => c.name.trim().length > 0)
  )

  const buildImages = (product: EligibleProduct): ImageInput[] => (
    [...product.images]
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ type: 'url' as const, url: img.url, alt: img.alt ?? undefined }))
  )

  const markPushStatus = async (productIds: string[], value: string): Promise<void> => {
    for (const productId of productIds) {
      await db.update(products)
        .set(getPushUpdate(platform, value) as Record<string, string>)
        .where(eq(products.id, productId))
    }
  }

  const logPushResult = async (
    productIds: string[],
    status: 'success' | 'error',
    message: string
  ): Promise<void> => {
    for (const productId of productIds) {
      await logOperation({
        productId,
        platform,
        action: 'push_product',
        status,
        message,
        triggeredBy,
      })
    }
  }

  const getMappedPlatformIdForTarget = (target: PushTarget): string | null => {
    if (target.kind === 'single') {
      return target.primary.platformMappings.find((m) => m.platform === platform)?.platformId ?? null
    }
    for (const member of target.members) {
      const hit = member.product.platformMappings.find((m) => m.platform === platform)?.platformId ?? null
      if (hit) return hit
    }
    return null
  }

  const findPlatformIdForTarget = async (target: PushTarget): Promise<string | null> => {
    if (target.kind === 'single') {
      return (connector.findProductIdBySku
        ? await callWithShopifyAuthRetry(() => connector.findProductIdBySku!(target.primary.id))
        : null) ?? null
    }
    const parentHit = (connector.findProductIdBySku
      ? await callWithShopifyAuthRetry(() => connector.findProductIdBySku!(target.parentSku))
      : null) ?? null
    if (parentHit) return parentHit
    for (const member of target.members) {
      const hit = (connector.findProductIdBySku
        ? await callWithShopifyAuthRetry(() => connector.findProductIdBySku!(member.product.id))
        : null) ?? null
      if (hit) return hit
    }
    return null
  }

  for (const target of toPush) {
    const productIds = target.kind === 'single'
      ? [target.primary.id]
      : target.members.map((member) => member.product.id)
    const primary = target.primary
    const completenessIssues = checkTargetCompleteness(target, platform)
    if (completenessIssues.length > 0) {
      incomplete.push(...completenessIssues)
      const issueSummary = completenessIssues
        .map((issue) => `${issue.sku}: ${issue.missing.join(', ')}`)
        .join(' | ')
      const failMessage = `Incomplete for ${platform}: ${issueSummary}`.slice(0, 200)
      await markPushStatus(productIds, `FAIL: ${failMessage}`)
      await logPushResult(productIds, 'error', failMessage)
      errors.push(issueSummary)
      processedTargets += 1
      await emitProgress(productIds, 'error', `Incomplete: ${primary.id}`)
      continue
    }
    const mappingPlatformId = getMappedPlatformIdForTarget(target)
    const mapping = mappingPlatformId ? { platformId: mappingPlatformId } : null
    if (mapping?.platformId) touchedPlatformIds.add(mapping.platformId)

    const totalStock = target.kind === 'single'
      ? getProductTotalStock(primary)
      : target.members.reduce((sum, member) => sum + member.totalStock, 0)
    const priceRow = getProductPriceRow(primary, platform)
    const coincartAttributeValuesRaw = platform === 'coincart2'
      ? collectCoincartAttributeValues(primary)
      : {}
    // For group targets, Color and Keyboard Layout are always variant option dimensions.
    // They must NOT also appear in product-level attributes (causes Coincart 500).
    const coincartAttributeValues = (target.kind === 'group' && platform === 'coincart2')
      ? Object.fromEntries(
          Object.entries(coincartAttributeValuesRaw).filter(([key]) =>
            key !== 'color' && key !== 'keyboard_layout'
          )
        )
      : coincartAttributeValuesRaw

    try {
      const identityPatch = target.kind === 'group'
        ? (
            platform.startsWith('shopify')
              ? {}
              : {
                  sku: target.parentSku,
                  collections: collectCollections(primary),
                  ...(platform === 'coincart2' && Object.keys(coincartAttributeValues).length > 0
                    ? { attributeValues: coincartAttributeValues }
                    : {}),
                }
          )
        : (
            platform.startsWith('shopify')
              ? { ean: primary.ean?.trim() ? primary.ean.trim() : undefined }
              : {
                  sku: primary.id,
                  ean: primary.ean?.trim() ? primary.ean.trim() : undefined,
                  collections: collectCollections(primary),
                  ...(platform === 'coincart2' && Object.keys(coincartAttributeValues).length > 0
                    ? { attributeValues: coincartAttributeValues }
                    : {}),
                }
          )
      const variantPayloads = target.kind === 'group'
        ? target.members.map((member) => {
            const layoutLabel = formatKeyboardLayout(member.keyboardLayout, member.product.id)
            const colorLabel = member.color?.trim() || null
            return {
              title: colorLabel ? `${layoutLabel} / ${colorLabel}` : layoutLabel,
              sku: member.product.id,
              price: member.priceRow?.price ?? null,
              compareAt: member.priceRow?.compareAt ?? null,
              stock: member.totalStock,
              optionName1: 'Keyboard Layout',
              option1: layoutLabel,
              optionName2: colorLabel ? 'Color' : null,
              option2: colorLabel,
              optionName3: null,
              option3: null,
            }
          })
        : buildVariantPayloads(primary, priceRow?.price ?? null, priceRow?.compareAt ?? null)
      const payloadWithVariants = {
        ...identityPatch,
        ...(variantPayloads?.length ? { variants: variantPayloads, replaceVariants: true } : {}),
      }

      const upsertMappings = async (platformId: string): Promise<void> => {
        const now = new Date().toISOString()
        if (target.kind === 'group') {
          for (const member of target.members) {
            await db.insert(platformMappings).values({
              productId: member.product.id,
              platform,
              platformId,
              recordType: 'variant',
              variantId: null,
              syncStatus: 'synced',
              lastSynced: now,
            }).onConflictDoUpdate({
              target: [platformMappings.productId, platformMappings.platform],
              set: { platformId, recordType: 'variant', variantId: null, syncStatus: 'synced', lastSynced: now },
            })
          }
          return
        }

        await db.insert(platformMappings).values({
          productId: primary.id,
          platform,
          platformId,
          syncStatus: 'synced',
          lastSynced: now,
        }).onConflictDoUpdate({
          target: [platformMappings.productId, platformMappings.platform],
          set: { platformId, syncStatus: 'synced', lastSynced: now },
        })
      }

      const updateExisting = async (platformId: string): Promise<void> => {
        if (target.kind === 'group') {
          if (platform === 'shopify_komputerzz') {
            if (!isWooSkuAware(connector)) {
              throw new Error(`Grouped variant updates are not supported for ${platform}`)
            }
            const skuAwareConnector = connector
            for (const member of target.members) {
              await callWithShopifyAuthRetry(() => skuAwareConnector.updatePriceForSku(platformId, member.product.id, member.priceRow?.price ?? null, member.priceRow?.compareAt ?? null))
              await callWithShopifyAuthRetry(() => skuAwareConnector.updateStockForSku(platformId, member.product.id, member.totalStock))
            }
            await callWithShopifyAuthRetry(() => connector.toggleStatus(platformId, 'active'))
            return
          }

          await callWithShopifyAuthRetry(() => connector.updateProduct(platformId, platform === 'coincart2' ? payloadWithVariants : {
            ...identityPatch,
            title: primary.title,
            description: primary.description,
            status: 'active',
            vendor: primary.vendor,
            productType: primary.productType,
          }))
          if (!isWooSkuAware(connector)) {
            throw new Error(`Grouped variant updates are not supported for ${platform}`)
          }
          const skuAwareConnector = connector
          for (const member of target.members) {
            await callWithShopifyAuthRetry(() => skuAwareConnector.updatePriceForSku(platformId, member.product.id, member.priceRow?.price ?? null, member.priceRow?.compareAt ?? null))
            await callWithShopifyAuthRetry(() => skuAwareConnector.updateStockForSku(platformId, member.product.id, member.totalStock))
          }
          await callWithShopifyAuthRetry(() => connector.toggleStatus(platformId, 'active'))
          return
        }

        if (platform === 'coincart2' && isWooSkuAware(connector)) {
          const skuAwareConnector = connector
          if (variantPayloads?.length) {
            await callWithShopifyAuthRetry(() => connector.updateProduct(platformId, payloadWithVariants))
            await callWithShopifyAuthRetry(() => connector.toggleStatus(platformId, 'active'))
          } else {
            await callWithShopifyAuthRetry(() => skuAwareConnector.updateProductForSku(platformId, primary.id, identityPatch))
            await callWithShopifyAuthRetry(() => skuAwareConnector.updatePriceForSku(platformId, primary.id, priceRow?.price ?? null, priceRow?.compareAt ?? null))
            await callWithShopifyAuthRetry(() => skuAwareConnector.updateStockForSku(platformId, primary.id, totalStock))
            await callWithShopifyAuthRetry(() => skuAwareConnector.toggleStatusForSku(platformId, primary.id, 'active'))
          }
          return
        }

        if (platform === 'shopify_komputerzz') {
          await callWithShopifyAuthRetry(() => connector.updatePrice(platformId, priceRow?.price ?? null, priceRow?.compareAt ?? null))
          await callWithShopifyAuthRetry(() => connector.updateStock(platformId, totalStock))
          await callWithShopifyAuthRetry(() => connector.toggleStatus(platformId, 'active'))
          return
        }

        await callWithShopifyAuthRetry(() => connector.updateProduct(platformId, payloadWithVariants))
        await callWithShopifyAuthRetry(() => connector.updatePrice(platformId, priceRow?.price ?? null, priceRow?.compareAt ?? null))
        await callWithShopifyAuthRetry(() => connector.updateStock(platformId, totalStock))
        await callWithShopifyAuthRetry(() => connector.toggleStatus(platformId, 'active'))
      }

      const createNew = async (): Promise<string> => {
        const images = buildImages(primary)
        const categoryIds = collectCategoryIds(primary)
        const collections = collectCollections(primary)

        const platformId = await callWithShopifyAuthRetry(() => connector.createProduct({
          sku: target.kind === 'group' ? target.parentSku : primary.id,
          ean: target.kind === 'group' ? null : (primary.ean?.trim() ? primary.ean.trim() : null),
          title: primary.title,
          description: primary.description,
          status: 'active',
          vendor: primary.vendor,
          productType: primary.productType,
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
        }))

        if (images.length > 0) await callWithShopifyAuthRetry(() => connector.setImages(platformId, images))
        if (target.kind === 'group') {
          if (!isWooSkuAware(connector)) {
            throw new Error(`Grouped variant stock updates are not supported for ${platform}`)
          }
          const skuAwareConnector = connector
          for (const member of target.members) {
            await callWithShopifyAuthRetry(() => skuAwareConnector.updatePriceForSku(platformId, member.product.id, member.priceRow?.price ?? null, member.priceRow?.compareAt ?? null))
            await callWithShopifyAuthRetry(() => skuAwareConnector.updateStockForSku(platformId, member.product.id, member.totalStock))
          }
        } else {
          await callWithShopifyAuthRetry(() => connector.updateStock(platformId, totalStock))
        }
        return platformId
      }

      const isCoincartSlugConflict = (message: string): boolean => (
        platform === 'coincart2'
        && message.includes('Coincart error: 409')
        && message.includes('slug already exists')
      )

      let finalPlatformId: string | null = null
      let successMessage = 'created'
      const mappedId = mapping?.platformId ?? null

      if (mappedId) {
        try {
          await updateExisting(mappedId)
          finalPlatformId = mappedId
          successMessage = 'updated by mapping'
        } catch (mappedErr) {
          const skuHit = await findPlatformIdForTarget(target)
          if (skuHit) {
            await upsertMappings(skuHit)
            await updateExisting(skuHit)
            finalPlatformId = skuHit
            successMessage = skuHit === mappedId ? 'updated by mapping after retry' : 'updated by SKU remap'
          } else {
            const createdId = await createNew()
            await upsertMappings(createdId)
            finalPlatformId = createdId
            newSkus.push(...productIds)
            successMessage = 'created after missing mapped ID'
          }
          if (!finalPlatformId) throw mappedErr
        }
      } else {
        const skuHit = await findPlatformIdForTarget(target)
        if (skuHit) {
          await upsertMappings(skuHit)
          await updateExisting(skuHit)
          finalPlatformId = skuHit
          successMessage = 'updated by SKU'
        } else {
          try {
            const createdId = await createNew()
            await upsertMappings(createdId)
            finalPlatformId = createdId
            newSkus.push(...productIds)
            successMessage = 'created'
          } catch (createErr) {
            const createMessage = createErr instanceof Error ? createErr.message : String(createErr)
            if (!isCoincartSlugConflict(createMessage)) throw createErr
            const recoveredId = await findPlatformIdForTarget(target)
            if (!recoveredId) throw createErr
            await upsertMappings(recoveredId)
            await updateExisting(recoveredId)
            finalPlatformId = recoveredId
            successMessage = 'updated after slug-conflict remap'
          }
        }
      }

      if (finalPlatformId) {
        touchedPlatformIds.add(finalPlatformId)
        if (!productIds.every((productId) => newSkus.includes(productId))) statusUpdated += productIds.length
      }

      // Shopify: when pushing to a non-TikTok Shopify channel, sync TikTok collections by title/handle.
      if (platform.startsWith('shopify') && platform !== 'shopify_tiktok') {
        const tikCats = primary.categories
          .filter((pc) => pc.category.platform === 'shopify_tiktok')
          .map((pc) => ({
            title: pc.category.name,
            handle: (pc.category.slug ?? slugifyHandle(pc.category.name)).trim(),
          }))
          .filter((c) => c.handle.length > 0)
        if (tikCats.length > 0 && typeof (connector as any).syncCollectionsToProduct === 'function') {
          await callWithShopifyAuthRetry(() => (connector as any).syncCollectionsToProduct(finalPlatformId!, tikCats))
        }
      }

      if (platform === 'shopify_komputerzz' && typeof (connector as any).syncProductAttributeMetafields === 'function' && finalPlatformId) {
        const productMetafields = collectShopifyProductMetafieldsFromAttributes(primary)
        if (Object.keys(productMetafields).length > 0) {
          await callWithShopifyAuthRetry(() => (connector as any).syncProductAttributeMetafields(finalPlatformId, productMetafields))
        }
      }

      if (platform === 'shopify_komputerzz' && typeof (connector as any).syncCollectionAttributeValues === 'function') {
        const targets = detectKomputerzzCollectionTargets(primary)
        const laptopKeys = new Set(Object.keys(ATTRIBUTE_OPTIONS.laptops))
        const displayKeys = new Set(Object.keys(ATTRIBUTE_OPTIONS.monitor))
        for (const target of targets) {
          const attrs = collectProductAttributeValues(
            primary,
            target.type === 'laptops' ? laptopKeys : displayKeys
          )
          if (Object.keys(attrs).length === 0) continue
          await callWithShopifyAuthRetry(() => (connector as any).syncCollectionAttributeValues(target.handle, attrs))
        }
      }

      await markPushStatus(productIds, 'done')
      await logPushResult(productIds, 'success', successMessage)
      processedTargets += 1
      await emitProgress(productIds, 'success', `${primary.id}: ${successMessage}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${primary.id}: ${msg}`)
      await markPushStatus(productIds, `FAIL: ${msg.slice(0, 200)}`)
      await logPushResult(productIds, 'error', msg)
      processedTargets += 1
      await emitProgress(productIds, 'error', `${primary.id}: ${msg}`)
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
      if (isWooSkuAware(connector)) {
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
    incomplete,
  }
}
