/**
 * TikTok Shop Open API client (v2) — signed calls, routed through Wizhard.
 *
 * Every request is HMAC-SHA256 signed with the app secret. Signature algorithm:
 *   base = app_secret + path + (sorted key+value for each query param, excluding
 *          `sign` and `access_token`) + body(if JSON) + app_secret
 * The body is deliberately EXCLUDED from the base for multipart/form-data uploads
 * (TikTok signs those without it) — see `tiktokUpload`.
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

/** Build the signed request URL (app_key/timestamp/sign appended). `bodyStr` is '' for multipart. */
async function buildSignedUrl(
  path: string, query: Record<string, string>, bodyStr: string,
): Promise<string> {
  const appKey = process.env.TIKTOK_APP_KEY
  const appSecret = process.env.TIKTOK_APP_SECRET
  if (!appKey || !appSecret) throw new Error('Missing TIKTOK_APP_KEY / TIKTOK_APP_SECRET')

  const q: Record<string, string> = {
    ...query,
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  }
  q.sign = await signRequest(path, q, bodyStr, appSecret)
  return `${BASE}${path}?${new URLSearchParams(q).toString()}`
}

/** Unwrap a TikTok envelope, throwing on a non-zero code. */
function unwrap(path: string, json: { code?: number; message?: string; data?: unknown }): unknown {
  if (json.code !== 0) throw new Error(`TikTok API ${path} failed: ${json.code ?? '?'} ${json.message ?? ''}`)
  return json.data
}

interface CallOpts {
  method?: 'GET' | 'POST'
  query?: Record<string, string>
  body?: unknown
  accessToken: string
}

/** Make a signed TikTok Shop API call and return the `data` payload (throws on API error). */
async function callTikTok(path: string, opts: CallOpts): Promise<unknown> {
  const bodyStr = opts.body ? JSON.stringify(opts.body) : ''
  const url = await buildSignedUrl(path, opts.query ?? {}, bodyStr)

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: { 'x-tts-access-token': opts.accessToken, 'content-type': 'application/json' },
    body: bodyStr || undefined,
  })
  return unwrap(path, (await res.json()) as { code?: number; message?: string; data?: unknown })
}

export interface TiktokShop { id: string; name?: string; region?: string; cipher?: string; code?: string }

/** GET /authorization/202309/shops — the shops this token can act on (incl. shop_cipher). */
export async function getAuthorizedShops(): Promise<TiktokShop[]> {
  const token = await getTiktokAccessToken()
  const data = (await callTikTok('/authorization/202309/shops', { accessToken: token })) as { shops?: TiktokShop[] }
  return data.shops ?? []
}

/** Home shop region used when a caller does not name one (the Irish shop; FR/ES/IT are Sell Across Europe shops). */
export const DEFAULT_SHOP_REGION = 'IE'

/**
 * Pick the shop of a given region. Since the token also covers the FR/ES/IT shops, TikTok's
 * shop order is not stable: never fall back to "the first shop", fail loudly instead.
 */
export function pickShop(shops: TiktokShop[], region: string): TiktokShop {
  const wanted = region.toUpperCase()
  const shop = shops.find((s) => s.cipher && (s.region ?? '').toUpperCase() === wanted)
  if (!shop) {
    const have = shops.map((s) => s.region ?? '?').join(', ') || 'none'
    throw new Error(`No authorized TikTok shop for region ${wanted} (authorized: ${have})`)
  }
  return shop
}

/** Resolve the shop_cipher for a region (default: TIKTOK_SHOP_REGION env, else IE). */
export async function getShopCipher(region?: string): Promise<string> {
  const shops = await getAuthorizedShops()
  return pickShop(shops, region ?? process.env.TIKTOK_SHOP_REGION ?? DEFAULT_SHOP_REGION).cipher as string
}

/** GET /product/202309/categories — the TikTok category tree for the shop. */
export async function getCategories(shopCipher: string, locale = 'en-GB'): Promise<unknown> {
  const token = await getTiktokAccessToken()
  return callTikTok('/product/202309/categories', {
    query: { shop_cipher: shopCipher, category_version: 'v2', locale },
    accessToken: token,
  })
}

/**
 * Generic signed TikTok API call through Wizhard (for iterating on endpoints without a redeploy).
 * Resolves the stored access token; adds shop_cipher when useShopCipher is set.
 */
export async function tiktokApiCall(
  path: string,
  opts: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown; useShopCipher?: boolean; shopRegion?: string } = {},
): Promise<unknown> {
  const token = await getTiktokAccessToken()
  const query = { ...(opts.query ?? {}) }
  // An explicit shop_cipher in the query wins over the region lookup.
  if (opts.useShopCipher && !query.shop_cipher) query.shop_cipher = await getShopCipher(opts.shopRegion)
  return callTikTok(path, { method: opts.method ?? 'GET', query, body: opts.body, accessToken: token })
}

/** POST /product/202309/products/search — the products currently on the TikTok shop. */
export async function searchProducts(shopCipher: string, pageSize = 50): Promise<unknown> {
  const token = await getTiktokAccessToken()
  return callTikTok('/product/202309/products/search', {
    method: 'POST',
    query: { shop_cipher: shopCipher, page_size: String(pageSize) },
    body: {},
    accessToken: token,
  })
}

export interface TiktokUploadFile {
  /** Raw file bytes. */
  bytes: Uint8Array
  /** Filename sent in the multipart part; TikTok uses the extension to type the file. */
  filename: string
  /** MIME type, e.g. image/png, application/pdf. */
  contentType: string
}

/**
 * Signed **multipart/form-data** upload (product images, certification files).
 *
 * TikTok rejects a JSON body on these endpoints (`36009022`), and — unlike JSON calls —
 * the body is NOT part of the signature base, so we sign with an empty body.
 * The boundary is generated by fetch: never set content-type by hand here.
 *
 * `fields` are extra form parts (e.g. `use_case` for images, `name` for files), passed
 * through verbatim so a new endpoint does not need a redeploy.
 *
 *   /product/202309/images/upload  → part `data` + `use_case`
 *   /product/202309/files/upload   → part `data` + `name`
 */
export async function tiktokUpload(
  path: string,
  file: TiktokUploadFile,
  fields: Record<string, string> = {},
  opts: { query?: Record<string, string>; useShopCipher?: boolean; shopRegion?: string } = {},
): Promise<unknown> {
  const token = await getTiktokAccessToken()
  const query = { ...(opts.query ?? {}) }
  if (opts.useShopCipher && !query.shop_cipher) query.shop_cipher = await getShopCipher(opts.shopRegion)

  // Empty body string: multipart payloads are excluded from the TikTok signature base.
  const url = await buildSignedUrl(path, query, '')

  const form = new FormData()
  form.append('data', new Blob([file.bytes as BlobPart], { type: file.contentType }), file.filename)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-tts-access-token': token },
    body: form,
  })
  return unwrap(path, (await res.json()) as { code?: number; message?: string; data?: unknown })
}
