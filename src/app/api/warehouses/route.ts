import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'

export const runtime = 'edge'

// GET — list all warehouses with current sync status
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.query.warehouses.findMany({
    orderBy: (t, { asc }) => [asc(t.id)],
  })

  return apiResponse(rows.map((w) => ({
    id:             w.id,
    displayName:    w.displayName,
    address:        w.address,
    sourceType:     w.sourceType,
    canModifyStock: !!w.canModifyStock,
    autoSync:       !!w.autoSync,
    lastSynced:     w.lastSynced,
    createdAt:      w.createdAt,
  })))
}
