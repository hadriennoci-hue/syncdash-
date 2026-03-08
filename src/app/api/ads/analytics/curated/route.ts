import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getCuratedAdsAnalytics } from '@/lib/functions/ads-analytics'

function defaultFrom(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

// GET /api/ads/analytics/curated
// Read-only curated analytics dataset for ads agent consumption.
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const from = req.nextUrl.searchParams.get('from') ?? defaultFrom()
  const to = req.nextUrl.searchParams.get('to') ?? defaultTo()
  const providerId = req.nextUrl.searchParams.get('providerId') ?? undefined
  const campaignPkRaw = req.nextUrl.searchParams.get('campaignPk')
  const campaignPk = campaignPkRaw ? Number(campaignPkRaw) : undefined

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return apiError('VALIDATION_ERROR', 'from/to must be YYYY-MM-DD', 400)
  }
  if (from > to) {
    return apiError('VALIDATION_ERROR', 'from must be <= to', 400)
  }
  if (campaignPkRaw && (!Number.isFinite(campaignPk) || campaignPk! <= 0)) {
    return apiError('VALIDATION_ERROR', 'campaignPk must be a positive integer', 400)
  }

  try {
    const data = await getCuratedAdsAnalytics({
      from,
      to,
      providerId,
      campaignPk,
    })
    return apiResponse(data)
  } catch (err) {
    return apiError('ADS_ANALYTICS_READ_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
