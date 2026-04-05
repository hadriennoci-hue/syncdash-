import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { ensureFreshShopifyToken, getStoredToken } from '@/lib/functions/tokens'

type ShopifyPlatform = 'shopify_komputerzz' | 'shopify_tiktok'

const SHOPS: Record<ShopifyPlatform, string | undefined> = {
  shopify_komputerzz: process.env.SHOPIFY_KOMPUTERZZ_SHOP,
  shopify_tiktok: process.env.SHOPIFY_TIKTOK_SHOP,
}

const fetchVendorCounts = async (shop: string, accessToken: string) => {
  const counts = new Map<string, number>()
  const samples = new Map<string, string[]>()
  let after: string | null = null
  let total = 0

  do {
    const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `
          query VendorAudit($after: String) {
            products(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                handle
                title
                vendor
              }
            }
          }
        `,
        variables: { after },
      }),
    })

    const payload = await response.json() as {
      data?: {
        products?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
          nodes?: Array<{ handle?: string | null; title?: string | null; vendor?: string | null }>
        }
      }
      errors?: Array<{ message?: string }>
    }

    if (!response.ok || payload.errors?.length) {
      throw new Error(
        payload.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
          `Shopify audit failed (${response.status})`
      )
    }

    const page = payload.data?.products
    const nodes = page?.nodes ?? []
    for (const node of nodes) {
      total += 1
      const vendor = String(node.vendor || '').trim() || '(empty)'
      counts.set(vendor, (counts.get(vendor) || 0) + 1)
      const entry = samples.get(vendor) ?? []
      if (entry.length < 5) {
        entry.push(`${String(node.handle || '').trim() || '(no-handle)'} | ${String(node.title || '').trim() || '(no-title)'}`)
      }
      samples.set(vendor, entry)
    }

    after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor || null : null
  } while (after)

  return {
    total,
    vendors: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([vendor, count]) => ({
        vendor,
        count,
        samples: samples.get(vendor) ?? [],
      })),
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const audits = await Promise.all(
    (Object.keys(SHOPS) as ShopifyPlatform[]).map(async (platform) => {
      const shop = String(SHOPS[platform] || '').trim()
      let token = await getStoredToken(platform)
      if (!token) {
        const refresh = await ensureFreshShopifyToken(platform, 0)
        if (!refresh.ok) {
          throw new Error(`${platform}: ${refresh.error ?? 'token refresh failed'}`)
        }
        token = await getStoredToken(platform)
      }
      if (!shop || !token) {
        throw new Error(`Missing shop or stored token for ${platform}`)
      }

      return {
        platform,
        shop,
        ...(await fetchVendorCounts(shop, token)),
      }
    })
  )

  return apiResponse({
    refreshedAt: new Date().toISOString(),
    audits,
  })
}
