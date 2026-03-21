import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { runSocialAnalyticsSync } from '@/lib/functions/social-analytics-sync'

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const result = await runSocialAnalyticsSync('human')
  return apiResponse({ ok: result.errors.length === 0, ...result })
}
