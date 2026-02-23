import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { syncWarehouse } from '@/lib/functions/warehouses'
import { db } from '@/lib/db/client'
import { warehouses } from '@/lib/db/schema'


// POST — sync all warehouses and return per-warehouse results
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const all = await db.query.warehouses.findMany()

  const results = await Promise.all(
    all.map(async (warehouse) => {
      try {
        return await syncWarehouse(warehouse.id, 'human')
      } catch (err) {
        return {
          warehouseId:     warehouse.id,
          productsUpdated: 0,
          errors:          [err instanceof Error ? err.message : 'Unknown error'],
          syncedAt:        new Date().toISOString(),
        }
      }
    })
  )

  return apiResponse(results)
}
