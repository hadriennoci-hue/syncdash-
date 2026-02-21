import { db } from '@/lib/db/client'
import { syncLog } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import type { TriggeredBy } from '@/types/platform'

interface LogEntry {
  productId?: string
  platform?: string
  action: string
  status: 'success' | 'error'
  message?: string
  triggeredBy: TriggeredBy
}

export async function logOperation(entry: LogEntry): Promise<void> {
  await db.insert(syncLog).values({
    id:          generateId(),
    productId:   entry.productId ?? null,
    platform:    entry.platform ?? null,
    action:      entry.action,
    status:      entry.status,
    message:     entry.message ?? null,
    triggeredBy: entry.triggeredBy,
    createdAt:   new Date().toISOString(),
  })
}
