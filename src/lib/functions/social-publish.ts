import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db/client'
import { socialMediaAccounts, socialMediaPosts } from '@/lib/db/schema'
import { logOperation } from '@/lib/functions/log'
import { oauth1AuthHeader, resolveXCreds, type XOAuthCreds } from '@/lib/functions/social-x'

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
