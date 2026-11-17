import { NextRequest } from 'next/server'
import { verifyBearer, bearerRole } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { tiktokApiCall, isReadOnlyTiktokCall } from '@/lib/functions/tiktok-api'

/**
 * POST /api/tiktok/call — generic signed TikTok API call, through Wizhard (bearer-protected).
 * Body: { path, method?, query?, body?, useShopCipher?, shopRegion? }. For iterating on TikTok endpoints.
 * shopRegion (IE default, or FR/ES/IT) picks which authorized shop's cipher is added.
 */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req, { allowReadOnly: true })
  if (auth) return auth
  let input: { path?: string; method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown; useShopCipher?: boolean; shopRegion?: string }
  try {
    input = await req.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Expected JSON body', 400)
  }
  if (!input.path) return apiError('VALIDATION_ERROR', 'path is required', 400)
  if (bearerRole(req) === 'readonly' && !isReadOnlyTiktokCall(input.path, input.method)) {
    return apiError('FORBIDDEN', 'Read-only token: only GET calls and POST search endpoints are allowed', 403)
  }
  try {
    const data = await tiktokApiCall(input.path, {
      method: input.method,
      query: input.query,
      body: input.body,
      useShopCipher: input.useShopCipher,
      shopRegion: input.shopRegion,
    })
    return apiResponse({ data })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
