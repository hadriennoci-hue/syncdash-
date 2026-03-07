// SKU prefixes that indicate non-hardware items (software keys, recovery tools, services).
// These appear on the ACER Store website but are not physical products — skip them on import.
const ACER_SKU_BLOCKLIST_PREFIXES = ['RECOVERY_', 'SERVICE_', 'SOFTWARE_', 'MEDIAKEY_']
const ACER_SKU_BLOCKLIST_SUFFIXES = ['_RFB']
const isBlockedAcerSku = (sku: string) =>
  ACER_SKU_BLOCKLIST_PREFIXES.some((prefix) => sku.toUpperCase().startsWith(prefix)) ||
  ACER_SKU_BLOCKLIST_SUFFIXES.some((suffix) => sku.toUpperCase().endsWith(suffix)) ||
  sku.toUpperCase().includes('_MEDIAKEY')

import { db } from '@/lib/db/client'
import { warehouses, warehouseStock, warehouseChannelRules, platformMappings, products, suppliers } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { createWarehouseConnector, createConnector } from '@/lib/connectors/registry'
import type { WarehouseStockProgress } from '@/lib/connectors/types'
import { logOperation } from './log'
import type { Platform, TriggeredBy } from '@/types/platform'
import { PLATFORMS } from '@/types/platform'

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

export async function pushStockToChannels(
  platforms: Platform[] = PLATFORMS,
  triggeredBy: TriggeredBy = 'system'
): Promise<ChannelStockResult[]> {
  const results: ChannelStockResult[] = []

  for (const platform of platforms) {
    const errors: string[] = []
    let productsUpdated = 0

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

    for (const mapping of mappings) {
      try {
        // Sum stock from all allowed warehouses for this product
        const stockRows = await db.query.warehouseStock.findMany({
          where: eq(warehouseStock.productId, mapping.productId),
        })

        const totalQuantity = allowedWarehouseIds.reduce((sum, warehouseId) => {
          const row = stockRows.find((s) => s.warehouseId === warehouseId)
          return sum + (row?.quantity ?? 0)
        }, 0)

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
