import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { importSalesData } from '@/lib/functions/sales-import'

const schema = z.object({
  channels: z.array(z.enum(['coincart2', 'shopify_komputerzz', 'shopify_tiktok'])).optional(),
  since: z.string().datetime().optional(),
  limitPerChannel: z.number().int().positive().max(5000).optional(),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// POST /api/sales/import
// Incrementally imports orders/refunds/transactions/fulfillments for API channels
// (WooCommerce + both Shopify channels) into raw + normalized sales tables.
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const result = await importSalesData(parsed.data)
  const allOk = result.channels.every((c) => c.ok)
  return apiResponse(result, allOk ? 200 : 207)
}


