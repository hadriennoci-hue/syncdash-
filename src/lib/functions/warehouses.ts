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
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { createWarehouseConnector, createConnector } from '@/lib/connectors/registry'
import type { WarehouseStockProgress } from '@/lib/connectors/types'
import { logOperation } from './log'
import type { Platform, TriggeredBy } from '@/types/platform'
import { PLATFORMS } from '@/types/platform'
import { generateId } from '@/lib/utils/id'

interface SyncResult {
  warehouseId: string
  productsUpdated: number
  errors: string[]
  syncedAt: string
}

interface SyncWarehouseOptions {
  onProgress?: (event: WarehouseStockProgress) => void
}

// ---------------------------------------------------------------------------
// syncWarehouse — reads stock from source and updates D1
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

  // For warehouses that return only in-stock items, zero existing stock first,
  // then upsert the returned SKUs. This avoids NOT IN with too many variables.
  // This only runs after a fully successful getStock() — if it throws, we never reach here.
  if (warehouseId === 'acer_store' || warehouseId === 'ireland') {
    await db.update(warehouseStock)
      .set({ quantity: 0, updatedAt: new Date().toISOString() })
      .where(eq(warehouseStock.warehouseId, warehouseId))
  }

  const errors: string[] = []
  let productsUpdated = 0

  // Ireland and ACER Store products are always supplied by ACER — ensure supplier row exists
  const isAcerSource = warehouseId === 'ireland' || warehouseId === 'acer_store'
  if (isAcerSource) {
    await db.insert(suppliers)
      .values({ id: 'acer', name: 'ACER' })
      .onConflictDoNothing()
  }

  for (const snap of snapshots) {
    if (isBlockedAcerSku(snap.sku)) continue
    if (snap.quantity <= 0) {
      // Zero out existing warehouse_stock if this product is already tracked,
      // but never auto-create a product record for zero-stock items.
      await db.update(warehouseStock)
        .set({ quantity: 0, updatedAt: new Date().toISOString() })
        .where(and(
          eq(warehouseStock.productId, snap.sku),
          eq(warehouseStock.warehouseId, warehouseId)
        ))
      continue
    }

    try {
      // Auto-create a minimal product record if it doesn't exist yet.
      // This prevents FK violations for new ACER SKUs not yet in D1.
      await db.insert(products)
        .values({
          id: snap.sku,
          title: snap.sourceName ?? snap.sku,
          status: 'active',
          pendingReview: 1,
          ...(isAcerSource ? { supplierId: 'acer' } : {}),
          // All ACER-sourced SKUs (Ireland + ACER Store): queue for Komputerzz + Coincart, skip TikTok
          ...(isAcerSource ? {
            pushedShopifyKomputerzz: '2push',
            pushedWoocommerce:       '2push',
            pushedEbayIe:            '2push',
            pushedShopifyTiktok:     'N',
          } : {}),
        })
        .onConflictDoNothing()

      // Set supplier to ACER on existing products if not already assigned
      if (isAcerSource) {
        await db.update(products)
          .set({ supplierId: 'acer' })
          .where(and(eq(products.id, snap.sku), isNull(products.supplierId)))
      }

      await db.insert(warehouseStock).values({
        productId:        snap.sku,
        warehouseId,
        quantity:         snap.quantity,
        sourceUrl:        snap.sourceUrl        ?? null,
        sourceName:       snap.sourceName       ?? null,
        importPrice:      snap.importPrice      ?? null,
        importPromoPrice: snap.importPromoPrice ?? null,
        updatedAt:        new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [warehouseStock.productId, warehouseStock.warehouseId],
        set: {
          quantity:         snap.quantity,
          sourceUrl:        snap.sourceUrl        ?? null,
          sourceName:       snap.sourceName       ?? null,
          importPrice:      snap.importPrice      ?? null,
          importPromoPrice: snap.importPromoPrice ?? null,
          updatedAt:        new Date().toISOString(),
        },
      })
      productsUpdated++
    } catch (err) {
      errors.push(`${snap.sku}: ${err instanceof Error ? err.message : 'Unknown'}`)
    }
  }

  // Post-scan zeroing is no longer needed for Ireland/ACER because we zeroed up front.

  const syncedAt = new Date().toISOString()
  await db.update(warehouses)
    .set({ lastSynced: syncedAt })
    .where(eq(warehouses.id, warehouseId))

  await logOperation({
    action:      'sync_warehouse',
    status:      errors.length === 0 ? 'success' : 'error',
    message:     `warehouse=${warehouseId} updated=${productsUpdated} errors=${errors.length}`,
    triggeredBy,
  })

  return { warehouseId, productsUpdated, errors, syncedAt }
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

type WooSkuAware = {
  bulkSetStockForSkus: (items: Array<{ platformId: string; sku: string; quantity: number }>) => Promise<void>
}

function isWooSkuAware(connector: unknown): connector is WooSkuAware {
  return !!connector && typeof (connector as WooSkuAware).bulkSetStockForSkus === 'function'
}

function supportsBatchTouchFinalize(platform: Platform): boolean {
  return platform === 'shopify_komputerzz' || platform === 'woocommerce'
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
          await connector.updateStock(mapping.platformId, totalQuantity)
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
            if (platform === 'woocommerce' && isWooSkuAware(connector)) {
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
          await connector.updateStock(mapping.platformId, totalQuantity)

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
