import { db } from '@/lib/db/client'
import { dailySyncLog } from '@/lib/db/schema'
import { pushStockToChannels } from '@/lib/functions/warehouses'
import { reconcileOrders } from '@/lib/functions/orders'
import { runApiHealthCheck } from '@/lib/functions/health'
import { generateId } from '@/lib/utils/id'
import { refreshShopifyTokens } from '@/lib/functions/tokens'
import { logOperation } from '@/lib/functions/log'

/**
 * Daily automation (manual endpoint only).
 * Warehouse refresh is intentionally excluded:
 * warehouse data must be refreshed only via explicit scan-warehouse actions.
 * 1. Reconcile open orders vs stock snapshots
 * 2. Push stock to channels from current D1 warehouse snapshot
 */
export async function runDailySync(): Promise<void> {
  const syncedAt = new Date().toISOString()
  const warehousesSynced: string[] = []
  const channelsPushed: string[] = []
  let ordersReconciled = 0
  let status: 'success' | 'partial' | 'error' = 'success'
  const messages: string[] = []

  // 1. Reconcile orders
  try {
    ordersReconciled = await reconcileOrders('system')
  } catch (err) {
    status = 'partial'
    messages.push(`reconcile: ${err instanceof Error ? err.message : 'error'}`)
  }

  // 2. Push stock to all channels respecting warehouse->channel routing rules
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
    id: generateId(),
    syncedAt,
    warehousesSynced: JSON.stringify(warehousesSynced),
    channelsPushed: JSON.stringify(channelsPushed),
    ordersReconciled,
    status,
    message: messages.join('; ') || null,
  })
}

/**
 * Daily health check - triggered by Cloudflare Cron at 06:00 UTC
 */
export async function runDailyHealthCheck(): Promise<void> {
  await runApiHealthCheck()
}

/**
 * Daily Shopify token refresh.
 * Stores fresh OAuth tokens in platform_tokens for shopify_komputerzz and shopify_tiktok.
 */
export async function runDailyTokenRefresh(): Promise<void> {
  const results = await refreshShopifyTokens()
  for (const result of results) {
    await logOperation({
      platform: result.platform,
      action: 'refresh_shopify_token',
      status: result.ok ? 'success' : 'error',
      message: result.ok
        ? `expiresAt=${result.expiresAt ?? 'unknown'}`
        : (result.error ?? 'unknown error'),
      triggeredBy: 'system',
    })
  }
}
