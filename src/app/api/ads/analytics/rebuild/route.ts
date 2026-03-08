import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { rebuildAdsCuratedAnalytics } from '@/lib/functions/ads-analytics'

const schema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// POST /api/ads/analytics/rebuild
// Rebuilds consolidated KPI tables from existing sales + ads daily metrics.
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  try {
    const result = await rebuildAdsCuratedAnalytics(parsed.data)
    return apiResponse(result)
  } catch (err) {
    return apiError('ADS_ANALYTICS_REBUILD_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
