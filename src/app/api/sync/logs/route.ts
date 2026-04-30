import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { paginatedResponse, apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { syncLog } from '@/lib/db/schema'
import { eq, desc, and, SQL } from 'drizzle-orm'
import { logOperation } from '@/lib/functions/log'

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


// GET — list sync log entries (paginated, filterable)
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page      = parseInt(searchParams.get('page') ?? '1')
  const perPage   = Math.min(parseInt(searchParams.get('perPage') ?? '100'), 500)
  const productId = searchParams.get('productId') ?? ''
  const platform  = searchParams.get('platform') ?? ''
  const action    = searchParams.get('action') ?? ''
  const status    = searchParams.get('status') ?? ''
  const offset    = (page - 1) * perPage

  const conditions: SQL[] = []
  if (productId) conditions.push(eq(syncLog.productId, productId))
  if (platform)  conditions.push(eq(syncLog.platform, platform))
  if (action)    conditions.push(eq(syncLog.action, action))
  if (status)    conditions.push(eq(syncLog.status, status as 'success' | 'error'))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, totalRows] = await Promise.all([
    db.select().from(syncLog)
      .where(where)
      .orderBy(desc(syncLog.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ id: syncLog.id }).from(syncLog).where(where),
  ])

  const parsedRows = rows.map((row) => {
    let details: FillLogDetails | null = null
    if (row.action === 'acer_fill' && row.message) {
      try {
        details = JSON.parse(row.message) as FillLogDetails
      } catch {
        details = null
      }
    }
    return { ...row, details }
  })

  return paginatedResponse(parsedRows, totalRows.length, page, perPage)
}

const postSchema = z.object({
  productId: z.string().optional(),
  platform: z.string().optional(),
  action: z.string().min(1).max(100),
  status: z.enum(['success', 'error']),
  message: z.string().max(5000).optional(),
  triggeredBy: z.enum(['human', 'agent', 'system']).default('agent'),
})

// POST â€” append a sync log entry (used by local browser runner/script)
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await logOperation({
    productId: parsed.data.productId,
    platform: parsed.data.platform,
    action: parsed.data.action,
    status: parsed.data.status,
    message: parsed.data.message,
    // logOperation currently accepts human|agent. Keep system mapped to agent.
    triggeredBy: parsed.data.triggeredBy === 'system' ? 'agent' : parsed.data.triggeredBy,
  })

  return apiResponse({ success: true }, 201)
}
