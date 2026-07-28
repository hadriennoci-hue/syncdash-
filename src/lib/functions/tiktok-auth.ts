/**
 * TikTok Shop Open API — OAuth for our own custom dev app (the direct complementary path).
 * All TikTok calls go through Wizhard; the AI/tools never call TikTok directly.
 *
 * Flow: seller authorizes our app → TikTok redirects to /api/tiktok/callback?code=... →
 * we exchange the code for an access + refresh token and store the bundle in `platform_tokens`
 * (platform='tiktok_shop') as JSON, mirroring the google_ads row. Access tokens are short-lived;
 * refresh with `refreshTiktokToken`.
 *
 * Endpoints (v2): https://auth.tiktok-shops.com/api/v2/token/get | /token/refresh
 * Docs: partner.tiktokshop.com/docv2/page/authorization-overview-202407
 */
import { db } from '@/lib/db/client'
import { platformTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const TIKTOK_PLATFORM = 'tiktok_shop'
const AUTH_BASE = 'https://auth.tiktok-shops.com'
const SERVICES_BASE = 'https://services.tiktokshop.com'

export interface TiktokTokenData {
  access_token: string
  access_token_expire_in: number   // absolute unix seconds
  refresh_token: string
  refresh_token_expire_in: number
  open_id?: string
  seller_name?: string
  seller_base_region?: string
  granted_scopes?: string[]
}

function creds(): { appKey: string; appSecret: string } {
  const appKey = process.env.TIKTOK_APP_KEY
  const appSecret = process.env.TIKTOK_APP_SECRET
  if (!appKey || !appSecret) throw new Error('Missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET')
  return { appKey, appSecret }
}

/** Build the token/get URL (pure — testable). */
export function buildTokenGetUrl(authCode: string, appKey: string, appSecret: string): string {
  const q = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: authCode,
    grant_type: 'authorized_code',
  })
  return `${AUTH_BASE}/api/v2/token/get?${q.toString()}`
}

/** Parse a TikTok token response, throwing on API error. Pure — testable. */
export function parseTokenResponse(json: unknown): { data: TiktokTokenData; expiresAtIso: string } {
  const body = json as { code?: number; message?: string; data?: TiktokTokenData }
  if (body.code !== 0 || !body.data?.access_token) {
    throw new Error(`TikTok token error: ${body.code ?? '?'} ${body.message ?? 'no access_token'}`)
  }
  const expiresAtIso = new Date((body.data.access_token_expire_in ?? 0) * 1000).toISOString()
  return { data: body.data, expiresAtIso }
}

async function persist(data: TiktokTokenData, expiresAtIso: string): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insert(platformTokens)
    .values({ platform: TIKTOK_PLATFORM, accessToken: JSON.stringify(data), expiresAt: expiresAtIso, refreshedAt: now })
    .onConflictDoUpdate({
      target: platformTokens.platform,
      set: { accessToken: JSON.stringify(data), expiresAt: expiresAtIso, refreshedAt: now },
    })
}

/** Exchange an authorization code for tokens and store them. Returns a summary (no secrets). */
export async function exchangeAuthCode(authCode: string): Promise<{ open_id?: string; seller_name?: string; expiresAt: string }> {
  const { appKey, appSecret } = creds()
  const res = await fetch(buildTokenGetUrl(authCode, appKey, appSecret))
  const { data, expiresAtIso } = parseTokenResponse(await res.json())
  await persist(data, expiresAtIso)
  return { open_id: data.open_id, seller_name: data.seller_name, expiresAt: expiresAtIso }
}

/** Refresh the access token using the stored refresh token. */
export async function refreshTiktokToken(): Promise<{ expiresAt: string }> {
  const { appKey, appSecret } = creds()
  const row = await db.query.platformTokens.findFirst({ where: eq(platformTokens.platform, TIKTOK_PLATFORM) })
  if (!row) throw new Error('No stored TikTok token to refresh — authorize the app first')
  const stored = JSON.parse(row.accessToken) as TiktokTokenData
  const q = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    refresh_token: stored.refresh_token,
    grant_type: 'refresh_token',
  })
  const res = await fetch(`${AUTH_BASE}/api/v2/token/refresh?${q.toString()}`)
  const { data, expiresAtIso } = parseTokenResponse(await res.json())
  await persist(data, expiresAtIso)
  return { expiresAt: expiresAtIso }
}

/** Get a valid stored access token for making API calls (refreshes if expired). */
export async function getTiktokAccessToken(): Promise<string> {
  const row = await db.query.platformTokens.findFirst({ where: eq(platformTokens.platform, TIKTOK_PLATFORM) })
  if (!row) throw new Error('TikTok not authorized yet')
  if (new Date(row.expiresAt).getTime() <= Date.now() + 60_000) {
    await refreshTiktokToken()
    const fresh = await db.query.platformTokens.findFirst({ where: eq(platformTokens.platform, TIKTOK_PLATFORM) })
    return (JSON.parse(fresh!.accessToken) as TiktokTokenData).access_token
  }
  return (JSON.parse(row.accessToken) as TiktokTokenData).access_token
}

/**
 * Build the seller authorization URL (with our CSRF `state`).
 * TikTok Shop uses a Partner-Center `service_id`; set TIKTOK_SERVICE_ID once it's known.
 */
export function buildAuthorizeUrl(state: string): string | null {
  const serviceId = process.env.TIKTOK_SERVICE_ID
  if (!serviceId) return null
  const q = new URLSearchParams({ service_id: serviceId, state })
  return `${SERVICES_BASE}/open/authorize?${q.toString()}`
}

/** Constant-time compare for the CSRF state check. */
export function stateMatches(received: string | null, expected: string | undefined): boolean {
  if (!expected) return true // state enforcement disabled when TIKTOK_OAUTH_STATE unset
  if (!received || received.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
