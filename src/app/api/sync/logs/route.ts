import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { syncLog } from '@/lib/db/schema'
import { eq, desc, and, SQL } from 'drizzle-orm'


// GET — list sync log entries (paginated, filterable)
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page      = parseInt(searchParams.get('page') ?? '1')
  const perPage   = Math.min(parseInt(searchParams.get('perPage') ?? '100'), 500)
  const productId = searchParams.get('productId') ?? ''
  const platform  = searchParams.get('platform') ?? ''
  const status    = searchParams.get('status') ?? ''
  const offset    = (page - 1) * perPage

  const conditions: SQL[] = []
  if (productId) conditions.push(eq(syncLog.productId, productId))
  if (platform)  conditions.push(eq(syncLog.platform, platform))
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

  return paginatedResponse(rows, totalRows.length, page, perPage)
}
