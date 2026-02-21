import { db } from '@/lib/db/client'
import { apiHealthLog } from '@/lib/db/schema'
import { getConnector, getWarehouseConnector, ALL_PLATFORMS, ALL_WAREHOUSE_IDS } from '@/lib/connectors/registry'
import { generateId } from '@/lib/utils/id'
import type { HealthCheckResult } from '@/lib/connectors/types'

interface HealthResults {
  checkedAt: string
  durationSeconds: number
  results: Record<string, HealthCheckResult>
}

export async function runApiHealthCheck(): Promise<HealthResults> {
  const start = Date.now()
  const checkedAt = new Date().toISOString()
  const results: Record<string, HealthCheckResult> = {}

  // Check all platform connectors
  for (const platform of ALL_PLATFORMS) {
    try {
      const connector = getConnector(platform)
      results[platform] = await connector.healthCheck()
    } catch (err) {
      results[platform] = {
        ok: false,
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Connector not available',
      }
    }
  }

  // Check all warehouse connectors
  for (const warehouseId of ALL_WAREHOUSE_IDS) {
    try {
      const connector = getWarehouseConnector(warehouseId)
      results[warehouseId] = await connector.healthCheck()
    } catch (err) {
      results[warehouseId] = {
        ok: false,
        latencyMs: null,
        error: err instanceof Error ? err.message : 'Connector not available',
      }
    }
  }

  const durationSeconds = (Date.now() - start) / 1000

  await db.insert(apiHealthLog).values({
    id:              generateId(),
    checkedAt,
    durationSeconds,
    results:         JSON.stringify(results),
    createdAt:       checkedAt,
  })

  return { checkedAt, durationSeconds, results }
}

export async function getLatestHealthCheck(): Promise<HealthResults | null> {
  const row = await db.query.apiHealthLog.findFirst({
    orderBy: (t, { desc }) => [desc(t.checkedAt)],
  })
  if (!row) return null
  return {
    checkedAt:       row.checkedAt,
    durationSeconds: row.durationSeconds ?? 0,
    results:         JSON.parse(row.results) as Record<string, HealthCheckResult>,
  }
}
