import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'

export const runtime = 'edge'

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

  const rows = await db.query.syncLog.findMany({
    limit:   perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })

  const filtered = rows.filter((r) => {
    if (productId && r.productId !== productId) return false
    if (platform  && r.platform  !== platform)  return false
    if (status    && r.status    !== status)    return false
    return true
  })

  return paginatedResponse(filtered, filtered.length, page, perPage)
}
