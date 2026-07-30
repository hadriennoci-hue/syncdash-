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

  // Shop identity — legal/billing name, contact, domain. Needs no special scope.
  const identity = await gql(`{
    shop {
      name
      contactEmail
      billingAddress { company address1 address2 city zip province country phone }
      primaryDomain { host url }
    }
  }`)
  if (!identity.ok) return apiError('SHOPIFY_API_ERROR', JSON.stringify(identity.errors), 502)

  // Store legal policies (refund/privacy/ToS/legal notice/contact). Needs read_legal_policies.
  const pol = await gql(`{ shop { shopPolicies { type title url body } } }`)
  const policies = pol.ok ? (pol.data?.shop as { shopPolicies?: unknown })?.shopPolicies : null
  const policiesError = pol.ok ? null : JSON.stringify(pol.errors)

  // Published pages (e.g. mentions légales). Needs read_content.
  const pg = await gql(`{ pages(first: 100) { nodes { title handle isPublished body } } }`)
  const pages = pg.ok ? (pg.data?.pages as { nodes?: unknown })?.nodes : null
  const pagesError = pg.ok ? null : JSON.stringify(pg.errors)

  return apiResponse({
    store: platform,
    shop,
    shop_info: identity.data?.shop,
    policies,
    policiesError,
    pages,
    pagesError,
  })
}
