import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { getCategories, getShopCipher } from '@/lib/functions/tiktok-api'

/**
 * GET /api/tiktok/categories — the TikTok category tree for our shop.
 * Resolves the shop_cipher automatically if not supplied. Bearer-protected; signed server-side.
 * First real use: fill channel_category_map.tiktok_category_id.
 */
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  try {
    const { searchParams } = new URL(req.url)
    const cipher = searchParams.get('shop_cipher') ?? (await getShopCipher())
    const locale = searchParams.get('locale') ?? 'en-GB'
    const data = await getCategories(cipher, locale)
    return apiResponse({ categories: data })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
