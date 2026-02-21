import { db } from '@/lib/db/client'
import { dailySyncLog, warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { syncWarehouse, pushStockToChannels } from '@/lib/functions/warehouses'
import { reconcileOrders } from '@/lib/functions/orders'
import { runApiHealthCheck } from '@/lib/functions/health'
import { generateId } from '@/lib/utils/id'

/**
 * Daily automation — triggered by Cloudflare Cron at 05:00 UTC
 * 1. Sync all warehouses with autoSync = 1
 * 2. Reconcile open orders vs stock snapshots
 * 3. (Channel push — configurable per channel, not TikTok which auto-syncs)
 */
export async function runDailySync(): Promise<void> {
  const syncedAt = new Date().toISOString()
  const warehousesSynced: string[] = []
  const channelsPushed: string[] = []
  let ordersReconciled = 0
  let status: 'success' | 'partial' | 'error' = 'success'
  const messages: string[] = []

  // 1. Sync warehouses
  const autoSyncWarehouses = await db.query.warehouses.findMany({
    where: eq(warehouses.autoSync, 1),
  })

  for (const warehouse of autoSyncWarehouses) {
    try {
      await syncWarehouse(warehouse.id, 'system')
      warehousesSynced.push(warehouse.id)
    } catch (err) {
      status = 'partial'
      messages.push(`warehouse ${warehouse.id}: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  // 2. Reconcile orders
  try {
    ordersReconciled = await reconcileOrders('system')
  } catch (err) {
    status = 'partial'
    messages.push(`reconcile: ${err instanceof Error ? err.message : 'error'}`)
  }

  // 3. Push stock to all channels respecting warehouse→channel routing rules
  try {
    const pushResults = await pushStockToChannels(undefined, 'system')
    for (const r of pushResults) {
      if (r.errors.length > 0) {
        status = 'partial'
        messages.push(`stock push ${r.platform}: ${r.errors.join('; ')}`)
      } else {
        channelsPushed.push(r.platform)
      }
    }
  } catch (err) {
    status = 'partial'
    messages.push(`stock push: ${err instanceof Error ? err.message : 'error'}`)
  }

  await db.insert(dailySyncLog).values({
    id:               generateId(),
    syncedAt,
    warehousesSynced: JSON.stringify(warehousesSynced),
    channelsPushed:   JSON.stringify(channelsPushed),
    ordersReconciled,
    status,
    message:          messages.join('; ') || null,
  })
}

/**
 * Daily health check — triggered by Cloudflare Cron at 06:00 UTC
 */
export async function runDailyHealthCheck(): Promise<void> {
  await runApiHealthCheck()
}
