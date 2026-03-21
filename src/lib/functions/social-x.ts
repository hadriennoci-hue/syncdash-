import { createHmac, randomBytes } from 'node:crypto'

export type XOAuthCreds = {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function oauthHeaderValue(params: Record<string, string>): string {
  const keys = Object.keys(params).sort()
  return `OAuth ${keys.map((k) => `${rfc3986(k)}="${rfc3986(params[k])}"`).join(', ')}`
}

function normalizeParamString(params: Array<[string, string]>): string {
  return params
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')
}

function resolveAccountSpecificCreds(accountId: string): Partial<XOAuthCreds> {
  const accountPrefix = `SOCIAL_X_${accountId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`
  const accountSpecific = {
    apiKey: process.env[`${accountPrefix}API_KEY`] ?? '',
    apiSecret: process.env[`${accountPrefix}API_SECRET`] ?? process.env[`${accountPrefix}API_KEY_SECRET`] ?? '',
    accessToken: process.env[`${accountPrefix}ACCESS_TOKEN`] ?? '',
    accessTokenSecret: process.env[`${accountPrefix}ACCESS_TOKEN_SECRET`] ?? '',
  }
  if (accountSpecific.apiKey && accountSpecific.apiSecret && accountSpecific.accessToken && accountSpecific.accessTokenSecret) {
    return accountSpecific
  }

  if (accountId === 'coincart_x') {
    const coincart = {
      apiKey: process.env.COINCART_X_API_KEY ?? '',
      apiSecret: process.env.COINCART_X_API_SECRET ?? '',
      accessToken: process.env.COINCART_X_ACCESS_TOKEN ?? '',
      accessTokenSecret: process.env.COINCART_X_ACCESS_TOKEN_SECRET ?? '',
    }
    if (coincart.apiKey && coincart.apiSecret && coincart.accessToken && coincart.accessTokenSecret) {
      return coincart
    }
  }

  if (accountId === 'komputerzz_x') {
    const komputerzz = {
      apiKey: process.env.KOMPUTERZZ_X_API_KEY ?? '',
      apiSecret: process.env.KOMPUTERZZ_X_API_SECRET ?? '',
      accessToken: process.env.KOMPUTERZZ_X_ACCESS_TOKEN ?? '',
      accessTokenSecret: process.env.KOMPUTERZZ_X_ACCESS_TOKEN_SECRET ?? '',
    }
    if (komputerzz.apiKey && komputerzz.apiSecret && komputerzz.accessToken && komputerzz.accessTokenSecret) {
      return komputerzz
    }
  }

  return {}
}

export function resolveXCreds(accountId: string): XOAuthCreds | null {
  const oauthRaw = resolveAccountSpecificCreds(accountId)
  return oauthRaw.apiKey && oauthRaw.apiSecret && oauthRaw.accessToken && oauthRaw.accessTokenSecret
    ? {
      apiKey: oauthRaw.apiKey,
      apiSecret: oauthRaw.apiSecret,
      accessToken: oauthRaw.accessToken,
      accessTokenSecret: oauthRaw.accessTokenSecret,
    }
    : null
}

export function oauth1AuthHeader(method: string, url: string, creds: XOAuthCreds): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }

  const parsedUrl = new URL(url)
  const requestParams: Array<[string, string]> = []
  for (const [k, v] of Object.entries(oauthParams)) requestParams.push([k, v])
  for (const [k, v] of parsedUrl.searchParams.entries()) requestParams.push([k, v])

  const normalized = normalizeParamString(requestParams)
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`
  const signatureBase = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join('&')
  const signingKey = `${rfc3986(creds.apiSecret)}&${rfc3986(creds.accessTokenSecret)}`
  const signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64')

  return oauthHeaderValue({ ...oauthParams, oauth_signature: signature })
}

export async function xGetJson<T>(accountId: string, url: string): Promise<T> {
  const creds = resolveXCreds(accountId)
  if (!creds) throw new Error(`missing account-specific X OAuth credentials for account ${accountId}`)

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: oauth1AuthHeader('GET', url, creds),
      Accept: 'application/json',
    },
  })

  const bodyText = await res.text()
  let parsed: unknown = {}
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    parsed = {}
  }

  if (!res.ok) {
    const apiMessage = typeof parsed === 'object' && parsed && 'errors' in parsed
      ? ((parsed as { errors?: Array<{ message?: string; detail?: string }> }).errors?.[0]?.detail
        ?? (parsed as { errors?: Array<{ message?: string; detail?: string }> }).errors?.[0]?.message)
      : null
    const fallback = bodyText.trim().slice(0, 300)
    throw new Error(apiMessage ? `X API ${res.status}: ${apiMessage}` : `X API ${res.status}: ${fallback || 'unknown error'}`)
  }

  return parsed as T
}
