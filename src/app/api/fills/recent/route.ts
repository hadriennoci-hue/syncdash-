import { NextRequest } from 'next/server'
import { and, desc, eq, gte, SQL } from 'drizzle-orm'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { syncLog } from '@/lib/db/schema'

type FillLogDetails = {
  fields?: string[]
  sourceUrl?: string
  sourceLocale?: string | null
  fetchLocale?: string | null
  needsTranslation?: boolean
  phase?: 'collection-only' | 'browser-fill'
  details?: Record<string, unknown>
  errors?: string[]
}

function parseFillDetails(message: string | null): FillLogDetails | null {
  if (!message) return null
  try {
    return JSON.parse(message) as FillLogDetails
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100', 10), 1), 500)
  const sinceHours = Math.min(Math.max(parseInt(searchParams.get('sinceHours') ?? '24', 10), 1), 24 * 30)
  const status = searchParams.get('status') ?? ''
  const createdAfter = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString()

  const conditions: SQL[] = [
    eq(syncLog.action, 'acer_fill'),
    eq(syncLog.platform, 'acer_store'),
    gte(syncLog.createdAt, createdAfter),
  ]
  if (status) conditions.push(eq(syncLog.status, status as 'success' | 'error'))

  const rows = await db.select().from(syncLog)
    .where(and(...conditions))
    .orderBy(desc(syncLog.createdAt))
    .limit(limit)

  const entries = rows.map((row) => {
    const parsed = parseFillDetails(row.message)
    return {
      id: row.id,
      createdAt: row.createdAt,
      productId: row.productId,
      status: row.status,
      triggeredBy: row.triggeredBy,
      fields: parsed?.fields ?? [],
      phase: parsed?.phase ?? null,
      sourceUrl: parsed?.sourceUrl ?? null,
      sourceLocale: parsed?.sourceLocale ?? null,
      fetchLocale: parsed?.fetchLocale ?? null,
      needsTranslation: parsed?.needsTranslation ?? false,
      details: parsed?.details ?? {},
      errors: parsed?.errors ?? [],
    }
  })

  const fieldCounts: Record<string, number> = {}
  for (const entry of entries) {
    for (const field of entry.fields) {
      fieldCounts[field] = (fieldCounts[field] ?? 0) + 1
    }
  }

  return apiResponse({
    entries,
    summary: {
      total: entries.length,
      success: entries.filter((entry) => entry.status === 'success').length,
      error: entries.filter((entry) => entry.status === 'error').length,
      fieldCounts,
    },
  })
}
