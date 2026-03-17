import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { warehouseStock } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { fillMissingFields } from '@/lib/functions/fill-missing'
import { requestRunnerWake } from '@/lib/functions/runner-signal'

const schema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const acerRows = await db.query.warehouseStock.findMany({
      where: eq(warehouseStock.productId, params.sku),
      columns: { warehouseId: true, sourceUrl: true },
    })
    const acerSource = acerRows.some((row) => row.warehouseId === 'acer_store' && !!row.sourceUrl)

    if (acerSource) {
      await requestRunnerWake('acer-fill', `fill-request:${params.sku}`)
      return apiResponse({
        sku: params.sku,
        status: 'queued',
        filled: [],
        missing: [],
        sources: ['acer-playwright-runner'],
      })
    }

    const result = await fillMissingFields(params.sku, parsed.data.triggeredBy)
    return apiResponse(result)
  } catch (err) {
    return apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
