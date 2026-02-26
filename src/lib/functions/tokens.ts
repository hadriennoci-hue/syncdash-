import { db } from '@/lib/db/client'
import { platformTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type ShopifyPlatform = 'shopify_komputerzz' | 'shopify_tiktok'

export interface TokenRefreshResult {
  platform: ShopifyPlatform
  ok: boolean
  expiresAt?: string
  error?: string
}

function getOAuthConfig(platform: ShopifyPlatform): {
  shop: string
  clientId: string
  clientSecret: string
} {
  if (platform === 'shopify_komputerzz') {
    return {
      shop:         process.env.SHOPIFY_KOMPUTERZZ_SHOP!,
      clientId:     process.env.SHOPIFY_KOMPUTERZZ_CLIENT_ID!,
      clientSecret: process.env.SHOPIFY_KOMPUTERZZ_CLIENT_SECRET!,
    }
  }
  return {
    shop:         process.env.SHOPIFY_TIKTOK_SHOP!,
    clientId:     process.env.SHOPIFY_TIKTOK_CLIENT_ID!,
    clientSecret: process.env.SHOPIFY_TIKTOK_CLIENT_SECRET!,
  }
}

async function refreshOne(platform: ShopifyPlatform): Promise<TokenRefreshResult> {
  try {
    const { shop, clientId, clientSecret } = getOAuthConfig(platform)
    if (!shop || !clientId || !clientSecret) {
      return { platform, ok: false, error: 'Missing OAuth credentials — add CLIENT_ID/CLIENT_SECRET env vars' }
    }

    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'client_credentials',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { platform, ok: false, error: `Shopify OAuth ${res.status}: ${body}` }
    }

    const data = await res.json() as { access_token?: string; expires_in?: number }
    if (!data.access_token) {
      return { platform, ok: false, error: 'No access_token in Shopify OAuth response' }
    }

    // Default to 24h if Shopify does not return expires_in
    const expiresInMs = (data.expires_in ?? 86400) * 1000
    const expiresAt   = new Date(Date.now() + expiresInMs).toISOString()
    const refreshedAt = new Date().toISOString()

    await db
      .insert(platformTokens)
      .values({ platform, accessToken: data.access_token, expiresAt, refreshedAt })
      .onConflictDoUpdate({
        target: platformTokens.platform,
        set:    { accessToken: data.access_token, expiresAt, refreshedAt },
      })

    return { platform, ok: true, expiresAt }
  } catch (err) {
    return {
      platform,
      ok:    false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/** Refreshes Shopify OAuth tokens for both shops and stores them in D1. */
export async function refreshShopifyTokens(): Promise<TokenRefreshResult[]> {
  return Promise.all([
    refreshOne('shopify_komputerzz'),
    refreshOne('shopify_tiktok'),
  ])
}

/**
 * Returns the stored OAuth token for the given Shopify platform if it exists and
 * has not expired (with a 5-minute safety buffer). Returns undefined otherwise,
 * which causes the connector to fall back to the static env var token.
 */
export async function getStoredToken(platform: ShopifyPlatform): Promise<string | undefined> {
  try {
    const row = await db.query.platformTokens.findFirst({
      where: eq(platformTokens.platform, platform),
    })
    if (!row) return undefined
    // Apply 5-minute buffer so we don't use a token that's about to expire
    const cutoff = new Date(row.expiresAt).getTime() - 5 * 60 * 1000
    if (Date.now() > cutoff) return undefined
    return row.accessToken
  } catch {
    return undefined
  }
}
