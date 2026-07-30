import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { ensureFreshShopifyToken, getStoredToken } from '@/lib/functions/tokens'
import type { ShopifyPlatform } from '@/lib/functions/tokens'

/**
 * GET /api/shopify/legal?store=komputerzz — read-only dump of a store's legal identity:
 * legal/billing name, store policies (refund/privacy/ToS/legal notice/…) and published pages.
 * Runs Worker-side (only the Worker can reach the Shopify Admin API). Bearer-protected.
 */
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const storeParam = new URL(req.url).searchParams.get('store') ?? 'komputerzz'
  const platform: ShopifyPlatform =
    storeParam === 'tiktok' || storeParam === 'techstore' ? 'shopify_tiktok' : 'shopify_komputerzz'
  const shop =
    platform === 'shopify_komputerzz'
      ? process.env.SHOPIFY_KOMPUTERZZ_SHOP
      : process.env.SHOPIFY_TIKTOK_SHOP
  if (!shop) return apiError('CONFIG_ERROR', `Missing shop domain for ${platform}`, 500)

  const fresh = await ensureFreshShopifyToken(platform, 24)
  if (!fresh.ok) return apiError('TOKEN_REFRESH_ERROR', fresh.error ?? 'token refresh failed', 500)
  const token = await getStoredToken(platform)
  if (!token) return apiError('TOKEN_ERROR', 'No stored token after refresh', 500)

  const gql = async (query: string) => {
    const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token, 'User-Agent': 'Wizhard/1.0' },
      body: JSON.stringify({ query }),
    })
    const j = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] }
    return { ok: res.ok && !j.errors?.length, data: j.data, errors: j.errors }
  }

  // Required: legal identity + store policies (refund/privacy/ToS/legal notice/contact).
  const core = await gql(`{
    shop {
      name
      contactEmail
      billingAddress { company address1 address2 city zip province country phone }
      primaryDomain { host url }
      shopPolicies { type title url body }
    }
  }`)
  if (!core.ok) return apiError('SHOPIFY_API_ERROR', JSON.stringify(core.errors), 502)

  // Best-effort: published pages (needs read_content scope). Tolerate ACCESS_DENIED.
  const pagesQuery = await gql(`{ pages(first: 100) { nodes { title handle isPublished body } } }`)
  const pages = pagesQuery.ok ? pagesQuery.data?.pages : null
  const pagesError = pagesQuery.ok ? null : JSON.stringify(pagesQuery.errors)

  return apiResponse({ store: platform, shop, shop_info: core.data?.shop, pages, pagesError })
}
