import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { tiktokApiCall } from '@/lib/functions/tiktok-api'

/**
 * POST /api/tiktok/call — generic signed TikTok API call, through Wizhard (bearer-protected).
 * Body: { path, method?, query?, body?, useShopCipher? }. For iterating on TikTok endpoints.
 */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  let input: { path?: string; method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown; useShopCipher?: boolean }
  try {
    input = await req.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Expected JSON body', 400)
  }
  if (!input.path) return apiError('VALIDATION_ERROR', 'path is required', 400)
  try {
    const data = await tiktokApiCall(input.path, {
      method: input.method,
      query: input.query,
      body: input.body,
      useShopCipher: input.useShopCipher,
    })
    return apiResponse({ data })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
