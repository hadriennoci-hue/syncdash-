import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { refreshShopifyTokens } from '@/lib/functions/tokens'

/**
 * POST /api/tokens/refresh
 *
 * Calls the Shopify client_credentials OAuth endpoint for both Shopify shops
 * and stores the resulting access tokens in D1. Tokens last 24 hours — call
 * this once per day via the "Test API connections" button on the home page.
 *
 * Requires:
 *   SHOPIFY_KOMPUTERZZ_CLIENT_ID, SHOPIFY_KOMPUTERZZ_CLIENT_SECRET
 *   SHOPIFY_TIKTOK_CLIENT_ID,     SHOPIFY_TIKTOK_CLIENT_SECRET
 */
export async function POST(req: NextRequest) {
  const authError = verifyBearer(req)
  if (authError) return authError

  try {
    const results = await refreshShopifyTokens()
    const allOk   = results.every((r) => r.ok)

    return apiResponse(
      { results },
      allOk ? 200 : 207  // 207 Multi-Status if at least one failed
    )
  } catch (err) {
    return apiError(
      'TOKEN_REFRESH_ERROR',
      err instanceof Error ? err.message : 'Unknown error',
      500
    )
  }
}
