/**
 * TikTok Shop Open API client (v2) — signed calls, routed through Wizhard.
 *
 * Every request is HMAC-SHA256 signed with the app secret. Signature algorithm:
 *   base = app_secret + path + (sorted key+value for each query param, excluding
 *          `sign` and `access_token`) + body(if JSON) + app_secret
 *   sign = hex( HMAC-SHA256(app_secret, base) )
 * access_token goes in the `x-tts-access-token` header; app_key/timestamp/sign in the query.
 * Local shops also pass `shop_cipher`.
 *
 * Docs: partner.tiktokshop.com/doc/page/63fd743e715d622a338c4eab (signature),
 *       /authorization/202309/shops, /product/202309/categories
 */
import { getTiktokAccessToken } from './tiktok-auth'

const BASE = 'https://open-api.tiktokglobalshop.com'

/** Build the exact string that gets HMAC'd. Pure — unit-tested. */
export function buildSignBase(
  path: string,
  query: Record<string, string>,
  body: string,
  appSecret: string,
): string {
  const keys = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
  let s = path
  for (const k of keys) s += k + query[k]
  if (body) s += body
  return appSecret + s + appSecret
}

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signRequest(
  path: string, query: Record<string, string>, body: string, appSecret: string,
): Promise<string> {
  return hmacSha256Hex(appSecret, buildSignBase(path, query, body, appSecret))
}

interface CallOpts {
  method?: 'GET' | 'POST'
  query?: Record<string, string>
  body?: unknown
  accessToken: string
}

/** Make a signed TikTok Shop API call and return the `data` payload (throws on API error). */
async function callTikTok(path: string, opts: CallOpts): Promise<unknown> {
  const appKey = process.env.TIKTOK_APP_KEY
  const appSecret = process.env.TIKTOK_APP_SECRET
  if (!appKey || !appSecret) throw new Error('Missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET')

  const query: Record<string, string> = {
    ...(opts.query ?? {}),
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  }
  const bodyStr = opts.body ? JSON.stringify(opts.body) : ''
  query.sign = await signRequest(path, query, bodyStr, appSecret)

  const res = await fetch(`${BASE}${path}?${new URLSearchParams(query).toString()}`, {
    method: opts.method ?? 'GET',
    headers: { 'x-tts-access-token': opts.accessToken, 'content-type': 'application/json' },
    body: bodyStr || undefined,
  })
  const json = (await res.json()) as { code?: number; message?: string; data?: unknown }
  if (json.code !== 0) throw new Error(`TikTok API ${path} failed: ${json.code ?? '?'} ${json.message ?? ''}`)
  return json.data
}

export interface TiktokShop { id: string; name?: string; region?: string; cipher?: string; code?: string }

/** GET /authorization/202309/shops — the shops this token can act on (incl. shop_cipher). */
export async function getAuthorizedShops(): Promise<TiktokShop[]> {
  const token = await getTiktokAccessToken()
  const data = (await callTikTok('/authorization/202309/shops', { accessToken: token })) as { shops?: TiktokShop[] }
  return data.shops ?? []
}

/** Resolve the shop_cipher for the (single) authorized local shop. */
export async function getShopCipher(): Promise<string> {
  const shops = await getAuthorizedShops()
  const cipher = shops.find((s) => s.cipher)?.cipher
  if (!cipher) throw new Error('No shop_cipher on any authorized shop')
  return cipher
}

/** GET /product/202309/categories — the TikTok category tree for the shop. */
export async function getCategories(shopCipher: string, locale = 'en-GB'): Promise<unknown> {
  const token = await getTiktokAccessToken()
  return callTikTok('/product/202309/categories', {
    query: { shop_cipher: shopCipher, category_version: 'v2', locale },
    accessToken: token,
  })
}
