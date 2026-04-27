import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { runXAdsAnalyticsSync } from '@/lib/functions/x-ads'

// POST /api/x-ads/sync
// First-pass X Ads analytics sync. Runs in dummy mode until real Ads API access exists.
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  try {
    const result = await runXAdsAnalyticsSync()
    return apiResponse(result)
  } catch (err) {
    return apiError('X_ADS_SYNC_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
