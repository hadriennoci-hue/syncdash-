import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getCuratedSocialAnalytics } from '@/lib/functions/social-analytics'

function defaultFrom(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 30)
  return d.toISOString().slice(0, 10)
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

// GET /api/social/analytics/curated
// Curated social performance analytics for agent reporting.
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const from = req.nextUrl.searchParams.get('from') ?? defaultFrom()
  const to = req.nextUrl.searchParams.get('to') ?? defaultTo()
  const accountId = req.nextUrl.searchParams.get('accountId') ?? undefined

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return apiError('VALIDATION_ERROR', 'from/to must be YYYY-MM-DD', 400)
  }
  if (from > to) {
    return apiError('VALIDATION_ERROR', 'from must be <= to', 400)
  }

  try {
    const data = await getCuratedSocialAnalytics({ from, to, accountId })
    return apiResponse(data)
  } catch (err) {
    return apiError(
      'SOCIAL_ANALYTICS_READ_ERROR',
      err instanceof Error ? err.message : 'Unknown error',
      500
    )
  }
}
