import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { createHmac, randomBytes } from 'node:crypto'
import { db } from '@/lib/db/client'
import { socialMediaAccounts, socialMediaPosts } from '@/lib/db/schema'
import { logOperation } from '@/lib/functions/log'

type XCreateTweetResponse = {
  data?: {
    id?: string
    text?: string
  }
  errors?: Array<{ message?: string }>
}

type PublishSummary = {
  scanned: number
  published: number
  failed: number
  errors: string[]
}

type XOAuthCreds = {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

function parseImageUrls(imageUrlsRaw: string | null, imageUrl: string | null): string[] {
  if (imageUrlsRaw) {
    try {
      const parsed = JSON.parse(imageUrlsRaw)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 4)
      }
    } catch {
      // Fall back to legacy single image field.
    }
  }
  return imageUrl ? [imageUrl] : []
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

function oauth1AuthHeader(method: string, url: string, creds: XOAuthCreds): string {
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

function resolveXCreds(accountId: string): XOAuthCreds | null {
  const oauthRaw = resolveAccountSpecificCreds(accountId)
  return oauthRaw.apiKey && oauthRaw.apiSecret && oauthRaw.accessToken && oauthRaw.accessTokenSecret
    ? {
      apiKey: oauthRaw.apiKey,
      apiSecret: oauthRaw.apiSecret,
      accessToken: oauthRaw.accessToken,
      accessTokenSecret: oauthRaw.accessTokenSecret,
    } as XOAuthCreds
    : null
}

function formatXError(json: XCreateTweetResponse, status: number, bodyText: string): string {
  const apiError = json.errors?.[0]?.message?.trim()
  if (apiError) return `X API ${status}: ${apiError}`
  const fallback = bodyText.trim()
  return fallback ? `X API ${status}: ${fallback.slice(0, 300)}` : `X API ${status}: unknown error`
}

async function postTweetWithOAuth(content: string, mediaIds: string[], creds: XOAuthCreds): Promise<string> {
  const endpoint = process.env.X_API_POST_TWEET_URL ?? 'https://api.twitter.com/2/tweets'
  const payload = mediaIds.length > 0
    ? { text: content, media: { media_ids: mediaIds } }
    : { text: content }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: oauth1AuthHeader('POST', endpoint, creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const bodyText = await res.text()
  let parsed: XCreateTweetResponse = {}
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as XCreateTweetResponse) : {}
  } catch {
    // Keep raw text fallback for error details.
  }

  if (!res.ok) throw new Error(formatXError(parsed, res.status, bodyText))
  const postId = parsed.data?.id?.trim()
  if (!postId) throw new Error('X API returned success without tweet id')
  return postId
}

async function uploadMediaToX(imageUrl: string, creds: XOAuthCreds): Promise<string> {
  const sourceRes = await fetch(imageUrl)
  if (!sourceRes.ok) throw new Error(`image download failed: ${imageUrl} (${sourceRes.status})`)

  const contentType = sourceRes.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
  if (!contentType.startsWith('image/')) {
    throw new Error(`unsupported media type for ${imageUrl}: ${contentType}`)
  }

  const bytes = Buffer.from(await sourceRes.arrayBuffer())
  const uploadEndpoint = process.env.X_API_UPLOAD_MEDIA_URL ?? 'https://upload.twitter.com/1.1/media/upload.json'
  const boundary = `----syncdash${randomBytes(12).toString('hex')}`
  const filename = imageUrl.split('/').pop()?.split('?')[0] || `image-${Date.now()}.jpg`
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    'utf8'
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const body = Buffer.concat([head, bytes, tail])

  const res = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      Authorization: oauth1AuthHeader('POST', uploadEndpoint, creds),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  })

  const bodyText = await res.text()
  let parsed: { media_id_string?: string; errors?: Array<{ message?: string }> } = {}
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as { media_id_string?: string; errors?: Array<{ message?: string }> }) : {}
  } catch {
    // Keep raw body fallback for debugging.
  }

  if (!res.ok) {
    const apiError = parsed.errors?.[0]?.message?.trim()
    throw new Error(apiError ? `X media upload ${res.status}: ${apiError}` : `X media upload ${res.status}: ${bodyText.slice(0, 300)}`)
  }
  if (!parsed.media_id_string) throw new Error('X media upload succeeded without media_id_string')
  return parsed.media_id_string
}

async function postToX(accountId: string, content: string, imageUrls: string[]): Promise<string> {
  const creds = resolveXCreds(accountId)
  if (!creds) throw new Error(`missing account-specific X OAuth credentials for account ${accountId}`)

  if (imageUrls.length > 0) {
    const mediaIds: string[] = []
    for (const imageUrl of imageUrls.slice(0, 4)) {
      mediaIds.push(await uploadMediaToX(imageUrl, creds))
    }
    return postTweetWithOAuth(content, mediaIds, creds)
  }

  return postTweetWithOAuth(content, [], creds)
}

export async function runSocialPublishCron(): Promise<PublishSummary> {
  const now = new Date().toISOString()
  const errors: string[] = []
  let published = 0
  let failed = 0

  const duePosts = await db
    .select({
      postPk: socialMediaPosts.postPk,
      accountId: socialMediaPosts.accountId,
      content: socialMediaPosts.content,
      imageUrl: socialMediaPosts.imageUrl,
      imageUrls: socialMediaPosts.imageUrls,
      scheduledFor: socialMediaPosts.scheduledFor,
      handle: socialMediaAccounts.handle,
      platform: socialMediaAccounts.platform,
      isActive: socialMediaAccounts.isActive,
    })
    .from(socialMediaPosts)
    .innerJoin(socialMediaAccounts, eq(socialMediaAccounts.id, socialMediaPosts.accountId))
    .where(and(
      eq(socialMediaPosts.status, 'validated'),
      isNull(socialMediaPosts.externalPostId),
      lte(socialMediaPosts.scheduledFor, now),
    ))
    .orderBy(asc(socialMediaPosts.scheduledFor), asc(socialMediaPosts.postPk))

  for (const post of duePosts) {
    if (post.platform !== 'x') continue
    if (post.isActive !== 1) {
      failed += 1
      const message = `postPk=${post.postPk} skipped: account ${post.accountId} is inactive`
      errors.push(message)
      await logOperation({ platform: 'x', action: 'social_publish', status: 'error', message, triggeredBy: 'system' })
      continue
    }

    const imageUrls = parseImageUrls(post.imageUrls, post.imageUrl)

    try {
      const externalPostId = await postToX(post.accountId, post.content, imageUrls)
      const publishedAt = new Date().toISOString()
      await db.update(socialMediaPosts).set({
        status: 'published',
        externalPostId,
        publishedAt,
        updatedAt: publishedAt,
      }).where(eq(socialMediaPosts.postPk, post.postPk))

      published += 1
      await logOperation({
        platform: 'x',
        action: 'social_publish',
        status: 'success',
        message: `postPk=${post.postPk} account=${post.accountId} handle=${post.handle} mediaCount=${imageUrls.length} externalPostId=${externalPostId}`,
        triggeredBy: 'system',
      })
    } catch (err) {
      failed += 1
      const message = `postPk=${post.postPk} failed: ${err instanceof Error ? err.message : 'unknown error'}`
      errors.push(message)
      await logOperation({ platform: 'x', action: 'social_publish', status: 'error', message, triggeredBy: 'system' })
    }
  }

  return {
    scanned: duePosts.length,
    published,
    failed,
    errors,
  }
}
