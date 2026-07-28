import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { getAuthorizedShops } from '@/lib/functions/tiktok-api'

/**
 * GET /api/tiktok/shops — the TikTok Shop(s) our token is authorized for (incl. shop_cipher).
 * Bearer-protected; the TikTok call is signed and made server-side (through Wizhard).
 */
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  try {
    const shops = await getAuthorizedShops()
    return apiResponse({ shops })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
