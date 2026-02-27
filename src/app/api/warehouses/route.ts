import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouseStock } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'


// GET — list all warehouses with current sync status
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.query.warehouses.findMany({
    orderBy: (t, { asc }) => [asc(t.id)],
  })

  const lastUpdated = await db.select({
    warehouseId: warehouseStock.warehouseId,
    lastUpdated: sql<string | null>`MAX(${warehouseStock.updatedAt})`,
  })
    .from(warehouseStock)
    .groupBy(warehouseStock.warehouseId)
  const lastUpdatedMap = new Map(lastUpdated.map((r) => [r.warehouseId, r.lastUpdated]))

  return apiResponse(rows.map((w) => ({
    id:             w.id,
    displayName:    w.displayName,
    address:        w.address,
    sourceType:     w.sourceType,
    canModifyStock: !!w.canModifyStock,
    autoSync:       !!w.autoSync,
    lastSynced:     w.lastSynced ?? lastUpdatedMap.get(w.id) ?? null,
    createdAt:      w.createdAt,
  })))
}
