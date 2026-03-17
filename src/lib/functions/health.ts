import { db } from '@/lib/db/client'
import { apiHealthLog, salesChannels } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createConnector, createWarehouseConnector, ALL_PLATFORMS, ALL_WAREHOUSE_IDS } from '@/lib/connectors/registry'
import { generateId } from '@/lib/utils/id'
import type { HealthCheckResult } from '@/lib/connectors/types'
import { getRunnerSignal } from './runner-signal'

interface HealthResults {
  checkedAt: string
  durationSeconds: number
  results: Record<string, HealthCheckResult>
}

function isMissingTableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('no such table') || msg.includes('no such column')
}

function normalizeEbayHealthResult(result: HealthCheckResult): HealthCheckResult {
  const err = (result.error ?? '').toLowerCase()
  if (
    err.includes('invalid_client') ||
    err.includes('missing ebay_') ||
    err.includes('ebay not configured')
  ) {
    return {
      ok: true,
      latencyMs: result.latencyMs ?? null,
      error: 'eBay not configured yet',
    }
  }
  return result
}

async function pingUrl(url: string): Promise<HealthCheckResult> {
  const start = Date.now()
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    const latencyMs = Date.now() - start
    if (res.ok || res.status < 500) {
      return { ok: true, latencyMs, error: null }
    }
    return { ok: false, latencyMs, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, latencyMs: null, error: err instanceof Error ? err.message : 'unreachable' }
  }
}

export async function runApiHealthCheck(): Promise<HealthResults> {
  const start = Date.now()
  const checkedAt = new Date().toISOString()
  const results: Record<string, HealthCheckResult> = {}

  // Check all API platform connectors
  for (const platform of ALL_PLATFORMS) {
    try {
      const connector = await createConnector(platform)
      const raw = await connector.healthCheck()
      results[platform] = platform === 'ebay_ie' ? normalizeEbayHealthResult(raw) : raw
    } catch (err) {
      const raw: HealthCheckResult = {
        ok: false,
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Connector not available',
      }
      results[platform] = platform === 'ebay_ie' ? normalizeEbayHealthResult(raw) : raw
    }
  }

  // Check browser channels — URL ping instead of API connector.
  // If local DB is partially migrated and sales_channels is missing, skip gracefully.
  try {
    const browserChannels = await db.query.salesChannels.findMany({
      where: eq(salesChannels.connectorType, 'browser'),
    })
    for (const ch of browserChannels) {
      if (ch.enabled) {
        results[ch.id] = await pingUrl(ch.url)
      }
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err
    }
  }

  // Check all warehouse connectors
  for (const warehouseId of ALL_WAREHOUSE_IDS) {
    try {
      const connector = await createWarehouseConnector(warehouseId)
      results[warehouseId] = await connector.healthCheck()
    } catch (err) {
      results[warehouseId] = {
        ok: false,
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Connector not available',
      }
    }
  }

  try {
    await getRunnerSignal('acer-stock')
    results.acer_store = {
      ok: true,
      latencyMs: null,
      error: 'Uses local acer runner',
    }
  } catch (err) {
    results.acer_store = {
      ok: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : 'Runner signal unavailable',
    }
  }

  const durationSeconds = (Date.now() - start) / 1000

  // Persist latest health snapshot when table exists; don't block health check otherwise.
  try {
    await db.insert(apiHealthLog).values({
      id:              generateId(),
      checkedAt,
      durationSeconds,
      results:         JSON.stringify(results),
      createdAt:       checkedAt,
    })
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err
    }
  }

  return { checkedAt, durationSeconds, results }
}

export async function getLatestHealthCheck(): Promise<HealthResults | null> {
  let row: typeof apiHealthLog.$inferSelect | undefined
  try {
    row = await db.query.apiHealthLog.findFirst({
      orderBy: (t, { desc }) => [desc(t.checkedAt)],
    })
  } catch (err) {
    if (isMissingTableError(err)) return null
    throw err
  }
  if (!row) return null
  return {
    checkedAt:       row.checkedAt,
    durationSeconds: row.durationSeconds ?? 0,
    results:         JSON.parse(row.results) as Record<string, HealthCheckResult>,
  }
}
