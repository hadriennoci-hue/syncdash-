import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { pushPrices } from '@/lib/functions/tiktok-listings'

const schema = z.object({
  regions: z.array(z.string()).optional(),
  skus: z.array(z.string()).optional(),
  dryRun: z.boolean().default(true),
})

/**
 * POST /api/tiktok/listings/push — send the wanted FR/ES/IT prices that differ from TikTok.
 * dryRun defaults to TRUE: pass `dryRun: false` to actually change prices.
 */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  try {
    return apiResponse(await pushPrices(parsed.data))
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
