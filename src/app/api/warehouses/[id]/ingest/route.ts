import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { applyWarehouseSnapshots } from '@/lib/functions/warehouses'

const snapshotSchema = z.object({
  sku:              z.string().min(1),
  quantity:         z.number().int().min(0),
  sourceUrl:        z.string().url().optional(),
  sourceName:       z.string().optional(),
  importPrice:      z.number().positive().nullable().optional(),
  importPromoPrice: z.number().positive().nullable().optional(),
})

const bodySchema = z.object({
  snapshots:   z.array(snapshotSchema).min(1).max(2000),
  triggeredBy: z.enum(['human', 'agent', 'system']).default('agent'),
})

// POST — ingest pre-scraped snapshots directly into D1, bypassing the connector.
// Used by the local Playwright scraper (scripts/scrape-acer-stock.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => null)
  if (!body) return apiError('VALIDATION_ERROR', 'Invalid JSON body', 400)

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const result = await applyWarehouseSnapshots(
      params.id,
      parsed.data.snapshots,
      parsed.data.triggeredBy,
    )
    return apiResponse(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError('INTERNAL_ERROR', message, 500)
  }
}
