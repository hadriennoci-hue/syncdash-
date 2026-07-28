import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { searchProducts, getShopCipher } from '@/lib/functions/tiktok-api'

/**
 * GET /api/tiktok/products — the products currently on the TikTok shop.
 * Used to verify the native Shopify→TikTok import (the final hop). Bearer-protected; signed server-side.
 */
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  try {
    const { searchParams } = new URL(req.url)
    const cipher = searchParams.get('shop_cipher') ?? (await getShopCipher())
    const data = await searchProducts(cipher)
    return apiResponse({ products: data })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}
