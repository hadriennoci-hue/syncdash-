// SKU prefixes that indicate non-hardware items (software keys, recovery tools, services).
// These appear on the ACER Store website but are not physical products — skip them on import.
const ACER_SKU_BLOCKLIST_PREFIXES = ['RECOVERY_', 'SERVICE_', 'SOFTWARE_', 'MEDIAKEY_']
const ACER_SKU_BLOCKLIST_SUFFIXES = ['_RFB']
const isBlockedAcerSku = (sku: string) =>
  ACER_SKU_BLOCKLIST_PREFIXES.some((prefix) => sku.toUpperCase().startsWith(prefix)) ||
  ACER_SKU_BLOCKLIST_SUFFIXES.some((suffix) => sku.toUpperCase().endsWith(suffix)) ||
  sku.toUpperCase().includes('_MEDIAKEY')

import { db } from '@/lib/db/client'
import { warehouses, warehouseStock, warehouseChannelRules, platformMappings, products, suppliers, syncJobs } from '@/lib/db/schema'
import { eq, and, gt, inArray, isNull } from 'drizzle-orm'
import { createWarehouseConnector, createConnector } from '@/lib/connectors/registry'
import type { WarehouseStockProgress, WarehouseStockSnapshot } from '@/lib/connectors/types'
import { logOperation } from './log'
import type { Platform, TriggeredBy } from '@/types/platform'
import { PLATFORMS } from '@/types/platform'

// Map from platform to the corresponding pushed_* column in the products table.
// Only platforms that have a pushed column are listed here.
const PLATFORM_PUSHED_FIELD: Partial<Record<Platform, keyof typeof products.$inferInsert>> = {
  coincart2:          'pushedCoincart2',
  shopify_komputerzz: 'pushedShopifyKomputerzz',
  shopify_tiktok:     'pushedShopifyTiktok',
  ebay_ie:            'pushedEbayIe',
  xmr_bazaar:         'pushedXmrBazaar',
  libre_market:       'pushedLibreMarket',
}
import { generateId } from '@/lib/utils/id'

interface SyncResult {
  warehouseId: string
  productsUpdated: number
  productsCreated: number
  existingProductsUpdated: number
  zeroedAbsent: number
  errors: string[]
  syncedAt: string
}

interface SyncWarehouseOptions {
  onProgress?: (event: WarehouseStockProgress) => void
}

interface ApplyWarehouseSnapshotsOptions {
  resetExisting?: boolean
  updateWarehouseSynced?: boolean
  logOperation?: boolean
  existingPositiveSkus?: string[]
  finalPositiveSkus?: string[]
}

// ---------------------------------------------------------------------------
// Source URL priority — higher number = higher priority.
// For acer_store: top-4 locales always overwrite existing URL in D1.
// Others: only set URL if currently NULL.
// ---------------------------------------------------------------------------

const TOP4_ACER_LOCALES = ['/en-ie/', '/fr-fr/', '/fr-be/', '/de-de/', '/nl-nl/', '/nl-be/']

function isTop4AcerLocale(sourceUrl: string | null): boolean {
  if (!sourceUrl) return false
  return TOP4_ACER_LOCALES.some(l => sourceUrl.includes(l))
}

function isEnglishAcerSource(sourceUrl: string | null): boolean {
  return !!sourceUrl?.includes('/en-ie/')
}

// ---------------------------------------------------------------------------
// applyWarehouseSnapshots — write a set of snapshots to D1 (shared logic)
// Called by syncWarehouse (connector path) and ingestWarehouseSnapshots (script path).
// ---------------------------------------------------------------------------

export async function getPositiveWarehouseSkus(warehouseId: string): Promise<string[]> {
  const rows = await db.select({ productId: warehouseStock.productId })
    .from(warehouseStock)
    .where(and(eq(warehouseStock.warehouseId, warehouseId), gt(warehouseStock.quantity, 0)))
  return rows.map(row => row.productId)
}

export async function applyWarehouseSnapshots(
  warehouseId: string,
  snapshots: WarehouseStockSnapshot[],
  triggeredBy: TriggeredBy = 'system',
  options: ApplyWarehouseSnapshotsOptions = {},
): Promise<SyncResult> {
  const {
    resetExisting = true,
    updateWarehouseSynced = true,
    logOperation: shouldLogOperation = true,
    existingPositiveSkus,
    finalPositiveSkus,
  } = options

  // A warehouse scan is treated as the full current truth for that warehouse.
  // Reset all existing quantities to zero first, then upsert scanned snapshots.
  const existingPositiveSkuSet = new Set(
    existingPositiveSkus ?? (resetExisting ? await getPositiveWarehouseSkus(warehouseId) : [])
  )
  if (resetExisting) {
    await db.update(warehouseStock)
      .set({ quantity: 0, updatedAt: new Date().toISOString() })
      .where(eq(warehouseStock.warehouseId, warehouseId))
  }

  const errors: string[] = []
  let productsUpdated = 0
  let productsCreated = 0
  let existingProductsUpdated = 0

  const isAcerSource = warehouseId === 'ireland' || warehouseId === 'acer_store'
  if (isAcerSource) {
    await db.insert(suppliers)
      .values({ id: 'acer', name: 'ACER' })
      .onConflictDoNothing()
  }

  // Pre-fetch all existing stock rows for this warehouse so we can apply
  // URL priority logic without N extra DB reads in the loop.
  // D1 has a ~100 bound-parameter limit per query, so chunk the inArray.
  const skusInBatch = snapshots.map(s => s.sku).filter(Boolean)
  const PREFETCH_CHUNK = 80 // stay safely under D1's variable limit
  const existingStockMap = new Map<string, { sourceUrl: string | null }>()
  if (isAcerSource && skusInBatch.length > 0) {
    for (let i = 0; i < skusInBatch.length; i += PREFETCH_CHUNK) {
      const chunk = skusInBatch.slice(i, i + PREFETCH_CHUNK)
      const rows = await db.select({
        productId: warehouseStock.productId,
        sourceUrl: warehouseStock.sourceUrl,
        quantity: warehouseStock.quantity,
      })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.warehouseId, warehouseId), inArray(warehouseStock.productId, chunk)))
      for (const row of rows) {
        existingStockMap.set(row.productId, { sourceUrl: row.sourceUrl })
      }
    }
  } else if (skusInBatch.length > 0) {
    for (let i = 0; i < skusInBatch.length; i += PREFETCH_CHUNK) {
      const chunk = skusInBatch.slice(i, i + PREFETCH_CHUNK)
      const rows = await db.select({
        productId: warehouseStock.productId,
        quantity: warehouseStock.quantity,
      })
        .from(warehouseStock)
        .where(and(eq(warehouseStock.warehouseId, warehouseId), inArray(warehouseStock.productId, chunk)))
      void rows
    }
  }

  // Pre-fetch which SKUs already exist in Wizhard and which platforms they are
  // mapped to, so that after the stock update we can mark those channels 2push.
  const existingProductIds = new Set<string>()
  if (skusInBatch.length > 0) {
    for (let i = 0; i < skusInBatch.length; i += PREFETCH_CHUNK) {
      const chunk = skusInBatch.slice(i, i + PREFETCH_CHUNK)
      const rows = await db.select({ id: products.id }).from(products).where(inArray(products.id, chunk))
      for (const row of rows) existingProductIds.add(row.id)
    }
  }
  // SKU → set of platforms it is already mapped to
  const existingSkuMappedPlatforms = new Map<string, Set<Platform>>()
  const existingSkus = skusInBatch.filter(s => existingProductIds.has(s))
  if (existingSkus.length > 0) {
    for (let i = 0; i < existingSkus.length; i += PREFETCH_CHUNK) {
      const chunk = existingSkus.slice(i, i + PREFETCH_CHUNK)
      const rows = await db.select({ productId: platformMappings.productId, platform: platformMappings.platform })
        .from(platformMappings)
        .where(inArray(platformMappings.productId, chunk))
      for (const row of rows) {
        const set = existingSkuMappedPlatforms.get(row.productId) ?? new Set<Platform>()
        set.add(row.platform as Platform)
        existingSkuMappedPlatforms.set(row.productId, set)
      }
    }
  }

  const finalPositiveSkuSet = new Set(finalPositiveSkus ?? [])
  for (const snap of snapshots) {
    if (isBlockedAcerSku(snap.sku)) continue
    if (snap.quantity <= 0) {
      await db.update(warehouseStock)
        .set({ quantity: 0, updatedAt: new Date().toISOString() })
        .where(and(
          eq(warehouseStock.productId, snap.sku),
          eq(warehouseStock.warehouseId, warehouseId)
        ))
      continue
    }

    try {
      const existedBefore = existingProductIds.has(snap.sku)
      await db.insert(products)
        .values({
          id: snap.sku,
          title: snap.sourceName ?? snap.sku,
          description: snap.description ?? null,
          status: 'info',
          pendingReview: 1,
          ...(isAcerSource ? { supplierId: 'acer', vendor: 'Acer' } : {}),
          ...(isAcerSource ? {
            pushedShopifyKomputerzz: '2push',
            pushedCoincart2:       '2push',
            pushedEbayIe:            '2push',
            pushedShopifyTiktok:     'N',
          } : {}),
        })
        .onConflictDoNothing()

      if (isAcerSource) {
        await db.update(products)
          .set({ supplierId: 'acer', vendor: 'Acer' })
          .where(and(eq(products.id, snap.sku), isNull(products.supplierId)))

        // en-ie scans always update the product title to the English name.
        if (isEnglishAcerSource(snap.sourceUrl ?? null) && snap.sourceName) {
          await db.update(products)
            .set({ title: snap.sourceName })
            .where(eq(products.id, snap.sku))
        }
      }

      // URL priority: top-4 locales (en-ie, fr, de, nl) always overwrite existing URL.
      // Other locales only set URL if currently NULL in D1.
      const existingUrl = existingStockMap.get(snap.sku)?.sourceUrl ?? null
      const newUrl = snap.sourceUrl ?? null
      const shouldUpdateUrl = newUrl !== null
        && (isTop4AcerLocale(newUrl) || existingUrl === null)

      await db.insert(warehouseStock).values({
        productId:        snap.sku,
        warehouseId,
        quantity:         snap.quantity,
        sourceUrl:        newUrl,
        sourceName:       snap.sourceName       ?? null,
        importPrice:      snap.importPrice      ?? null,
        importPromoPrice: snap.importPromoPrice ?? null,
        updatedAt:        new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [warehouseStock.productId, warehouseStock.warehouseId],
        set: {
          quantity:         snap.quantity,
          sourceUrl:        shouldUpdateUrl ? newUrl : existingUrl,
          sourceName:       snap.sourceName       ?? null,
          importPrice:      snap.importPrice      ?? null,
          importPromoPrice: snap.importPromoPrice ?? null,
          updatedAt:        new Date().toISOString(),
        },
      })
      productsUpdated++
      if (existedBefore) existingProductsUpdated++
      else productsCreated++
      finalPositiveSkuSet.add(snap.sku)
    } catch (err) {
      errors.push(`${snap.sku}: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  let zeroedAbsent = 0
  for (const sku of existingPositiveSkuSet) {
    if (!finalPositiveSkuSet.has(sku)) zeroedAbsent++
  }

  // For each platform, mark existing mapped products as 2push so the channel
  // sync picks up the updated stock on the next push run.
  if (existingSkuMappedPlatforms.size > 0) {
    for (const [platform, field] of Object.entries(PLATFORM_PUSHED_FIELD) as [Platform, keyof typeof products.$inferInsert][]) {
      const skusToMark = [...existingSkuMappedPlatforms.entries()]
        .filter(([, platforms]) => platforms.has(platform))
        .map(([sku]) => sku)
      if (skusToMark.length === 0) continue
      for (let i = 0; i < skusToMark.length; i += PREFETCH_CHUNK) {
        const chunk = skusToMark.slice(i, i + PREFETCH_CHUNK)
        await db.update(products)
          .set({ [field]: '2push' } as Partial<typeof products.$inferInsert>)
          .where(inArray(products.id, chunk))
      }
    }
  }

  const syncedAt = new Date().toISOString()
  if (updateWarehouseSynced) {
    await db.update(warehouses)
      .set({ lastSynced: syncedAt })
      .where(eq(warehouses.id, warehouseId))
  }

  if (shouldLogOperation) {
    await logOperation({
      action:      'sync_warehouse',
      status:      errors.length === 0 ? 'success' : 'error',
      message:     `warehouse=${warehouseId} updated=${productsUpdated} created=${productsCreated} existing=${existingProductsUpdated} zeroed=${zeroedAbsent} errors=${errors.length}`,
      triggeredBy,
    })
  }

  return { warehouseId, productsUpdated, productsCreated, existingProductsUpdated, zeroedAbsent, errors, syncedAt }
}

// ---------------------------------------------------------------------------
// syncWarehouse — reads stock from source connector and writes to D1
// ---------------------------------------------------------------------------

export async function syncWarehouse(
  warehouseId: string,
  triggeredBy: TriggeredBy = 'system',
  options: SyncWarehouseOptions = {}
): Promise<SyncResult> {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId),
  })
  if (!warehouse) throw new Error(`Warehouse not found: ${warehouseId}`)

  const connector = await createWarehouseConnector(warehouseId)
  const snapshots = await connector.getStock({
    onProgress: (event) => options.onProgress?.({
      ...event,
      warehouseId: event.warehouseId ?? warehouseId,
    }),
  })

  return applyWarehouseSnapshots(warehouseId, snapshots, triggeredBy)
}

// ---------------------------------------------------------------------------
// overrideWarehouseStock — manual override
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// pushStockToChannels — compute available stock per channel from routing
//   rules and push the total quantity to each platform via connector
// ---------------------------------------------------------------------------

interface ChannelStockResult {
  platform: Platform
  productsUpdated: number
  errors: string[]
}

type SkuAwareStockConnector = {
  updateStockForSku: (platformId: string, sku: string, quantity: number) => Promise<void>
  bulkSetStockForSkus: (items: Array<{ platformId: string; sku: string; quantity: number }>) => Promise<void>
}

function isSkuAwareStockConnector(connector: unknown): connector is SkuAwareStockConnector {
  return !!connector
    && typeof (connector as SkuAwareStockConnector).updateStockForSku === 'function'
    && typeof (connector as SkuAwareStockConnector).bulkSetStockForSkus === 'function'
}

function supportsBatchTouchFinalize(platform: Platform): boolean {
  return platform === 'shopify_komputerzz' || platform === 'coincart2'
}

export async function pushStockToChannels(
  platforms: Platform[] = PLATFORMS,
  triggeredBy: TriggeredBy = 'system'
): Promise<ChannelStockResult[]> {
  const results: ChannelStockResult[] = []

  for (const platform of platforms) {
    const errors: string[] = []
    let productsUpdated = 0
    let touchedCount = 0
    let zeroedCount = 0
    let currentBatchId: string | null = null
    const startedAt = new Date().toISOString()
    const syncJobId = generateId()

    // Get all warehouse → channel rules for this platform, ordered by priority
    const rules = await db.query.warehouseChannelRules.findMany({
      where: eq(warehouseChannelRules.platform, platform),
      orderBy: (t, { asc }) => [asc(t.priority)],
    })

    if (rules.length === 0) {
      results.push({ platform, productsUpdated: 0, errors: [] })
      continue
    }

    const allowedWarehouseIds = rules.map((r) => r.warehouseId)

    // Get platform mappings (products that exist on this channel)
    const mappings = await db.query.platformMappings.findMany({
      where: eq(platformMappings.platform, platform),
    })

    const connector = await createConnector(platform)
    await db.insert(syncJobs).values({
      id: syncJobId,
      jobType: 'push_stock',
      platform,
      status: 'running',
      startedAt,
      triggeredBy,
    })

    const stockRows = await db.query.warehouseStock.findMany({
      where: inArray(warehouseStock.warehouseId, allowedWarehouseIds),
      columns: { productId: true, quantity: true },
    })
    const quantityByProductId = new Map<string, number>()
    for (const row of stockRows) {
      quantityByProductId.set(row.productId, (quantityByProductId.get(row.productId) ?? 0) + (row.quantity ?? 0))
    }

    if (supportsBatchTouchFinalize(platform)) {
      const syncBatchId = generateId()
      currentBatchId = syncBatchId
      const touchedPlatformIds = new Set<string>()

      for (const mapping of mappings) {
        const totalQuantity = quantityByProductId.get(mapping.productId) ?? 0
        if (totalQuantity <= 0) continue

        try {
          if (mapping.recordType === 'variant' && isSkuAwareStockConnector(connector)) {
            await connector.updateStockForSku(mapping.platformId, mapping.productId, totalQuantity)
          } else {
            await connector.updateStock(mapping.platformId, totalQuantity)
          }
          touchedPlatformIds.add(mapping.platformId)
          touchedCount++
          await db.update(platformMappings)
            .set({
              lastStockSyncBatchId: syncBatchId,
              lastSeenInFeedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(and(
              eq(platformMappings.productId, mapping.productId),
              eq(platformMappings.platform, platform)
            ))

          await logOperation({
            productId:   mapping.productId,
            platform,
            action:      'push_stock',
            status:      'success',
            message:     `qty=${totalQuantity} batch=${syncBatchId} warehouses=[${allowedWarehouseIds.join(',')}]`,
            triggeredBy,
          })
          productsUpdated++
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`${mapping.productId}: ${message}`)
          await logOperation({
            productId: mapping.productId,
            platform,
            action:    'push_stock',
            status:    'error',
            message,
            triggeredBy,
          })
        }
      }

      if (errors.length === 0) {
        const toZero = mappings
          .filter((m) => !touchedPlatformIds.has(m.platformId))
          .map((m) => ({ platformId: m.platformId, sku: m.productId, quantity: 0 }))

        if (toZero.length > 0) {
          try {
            if (isSkuAwareStockConnector(connector)) {
              await connector.bulkSetStockForSkus(toZero)
            } else {
              await connector.bulkSetStock(
                toZero.map(({ platformId, quantity }) => ({ platformId, quantity }))
              )
            }

            for (const item of toZero) {
              await db.update(platformMappings)
                .set({
                  lastStockSyncBatchId: syncBatchId,
                  updatedAt: new Date().toISOString(),
                })
                .where(and(
                  eq(platformMappings.productId, item.sku),
                  eq(platformMappings.platform, platform)
                ))
            }

            productsUpdated += toZero.length
            zeroedCount += toZero.length
            await logOperation({
              platform,
              action: 'push_stock_finalize_zero',
              status: 'success',
              message: `batch=${syncBatchId} zeroed=${toZero.length}`,
              triggeredBy,
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            errors.push(`finalize_zero: ${message}`)
            await logOperation({
              platform,
              action: 'push_stock_finalize_zero',
              status: 'error',
              message: `batch=${syncBatchId} ${message}`,
              triggeredBy,
            })
          }
        }
      } else {
        await logOperation({
          platform,
          action: 'push_stock_finalize_zero',
          status: 'error',
          message: `batch=${syncBatchId} skipped due to per-SKU errors=${errors.length}`,
          triggeredBy,
        })
      }
    } else {
      for (const mapping of mappings) {
        try {
          const totalQuantity = quantityByProductId.get(mapping.productId) ?? 0
          if (mapping.recordType === 'variant' && isSkuAwareStockConnector(connector)) {
            await connector.updateStockForSku(mapping.platformId, mapping.productId, totalQuantity)
          } else {
            await connector.updateStock(mapping.platformId, totalQuantity)
          }

          await logOperation({
            productId:   mapping.productId,
            platform,
            action:      'push_stock',
            status:      'success',
            message:     `qty=${totalQuantity} from warehouses=[${allowedWarehouseIds.join(',')}]`,
            triggeredBy,
          })
          productsUpdated++
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`${mapping.productId}: ${message}`)
          await logOperation({
            productId: mapping.productId,
            platform,
            action:    'push_stock',
            status:    'error',
            message,
            triggeredBy,
          })
        }
      }
    }

    await db.update(syncJobs)
      .set({
        batchId: currentBatchId,
        status: errors.length > 0 ? 'error' : 'success',
        finishedAt: new Date().toISOString(),
        touched: touchedCount,
        zeroed: zeroedCount,
        errorsCount: errors.length,
        message: errors.length > 0 ? errors.join('; ').slice(0, 1000) : null,
      })
      .where(eq(syncJobs.id, syncJobId))

    results.push({ platform, productsUpdated, errors })
  }

  return results
}

// ---------------------------------------------------------------------------
// overrideWarehouseStock — manual override
// ---------------------------------------------------------------------------

interface StockOverride {
  quantity?: number
  quantityOrdered?: number
  lastOrderDate?: string
  purchasePrice?: number
}

export async function overrideWarehouseStock(
  warehouseId: string,
  productId: string,
  override: StockOverride,
  triggeredBy: TriggeredBy = 'human'
): Promise<void> {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId),
  })

  if (!warehouse) throw new Error(`Warehouse not found: ${warehouseId}`)
  const isStockWrite = override.quantity !== undefined || override.purchasePrice !== undefined
  if (isStockWrite && !warehouse.canModifyStock) {
    throw new Error(`Warehouse ${warehouseId} is read-only (canModifyStock = 0)`)
  }

  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (override.quantity !== undefined)        set.quantity = override.quantity
  if (override.quantityOrdered !== undefined) set.quantityOrdered = override.quantityOrdered
  if (override.lastOrderDate !== undefined)   set.lastOrderDate = override.lastOrderDate
  if (override.purchasePrice !== undefined)   set.purchasePrice = override.purchasePrice

  await db.insert(warehouseStock).values({
    productId,
    warehouseId,
    quantity:        override.quantity ?? 0,
    quantityOrdered: override.quantityOrdered ?? 0,
    lastOrderDate:   override.lastOrderDate ?? null,
    purchasePrice:   override.purchasePrice ?? null,
    updatedAt:       new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [warehouseStock.productId, warehouseStock.warehouseId],
    set,
  })

  await logOperation({
    productId,
    action:      'override_stock',
    status:      'success',
    message:     `warehouse=${warehouseId} qty=${override.quantity ?? 'unchanged'}`,
    triggeredBy,
  })
}

