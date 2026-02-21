import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { syncWarehouse } from '@/lib/functions/warehouses'
import { db } from '@/lib/db/client'
import { warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'edge'

const postSchema = z.object({
  triggeredBy: z.enum(['human', 'agent', 'system']).default('human'),
})

// POST — trigger a manual warehouse stock sync
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, params.id),
  })
  if (!warehouse) return apiError('NOT_FOUND', `Warehouse ${params.id} not found`, 404)

  const body = await req.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    await syncWarehouse(params.id, parsed.data.triggeredBy)
    return apiResponse({ success: true, warehouseId: params.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError('SYNC_ERROR', message, 500)
  }
}
