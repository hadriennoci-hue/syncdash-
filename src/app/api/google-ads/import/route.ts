import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { importGoogleAdsData } from '@/lib/functions/google-ads'

const schema = z.object({
  customerId: z.string().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// POST /api/google-ads/import
// Pulls Google Ads campaigns, ad groups and click_view rows into D1.
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  try {
    const result = await importGoogleAdsData(parsed.data)
    return apiResponse(result)
  } catch (err) {
    return apiError(
      'GOOGLE_ADS_IMPORT_ERROR',
      err instanceof Error ? err.message : 'Unknown error',
      500
    )
  }
}
