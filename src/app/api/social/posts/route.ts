import { NextRequest } from 'next/server'
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialMediaAccounts, socialMediaPosts } from '@/lib/db/schema'

const statusSchema = z.enum(['suggested', 'validated', 'canceled', 'published'])
const platformSchema = z.enum(['x', 'instagram'])

const createSchema = z.object({
  accountId: z.string().min(1),
  platform: platformSchema.optional(),
  content: z.string().min(1).max(500),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).max(4).optional(),
  hypothesis: z.string().max(500).optional(),
  variantLabel: z.string().max(120).optional(),
  experimentGroup: z.string().max(120).optional(),
  quoteTweetId: z.string().regex(/^\d+$/).optional(),
  scheduledFor: z.string().datetime(),
  status: statusSchema.optional(),
  createdBy: z.enum(['agent', 'human', 'system']).default('agent'),
})

function parseImageUrls(raw: string | null, single: string | null): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const urls = parsed.filter((v): v is string => typeof v === 'string').slice(0, 4)
        if (urls.length > 0) return urls
      }
    } catch {
      // ignore malformed historical rows
    }
  }
  return single ? [single] : []
}

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const excludeStatus = req.nextUrl.searchParams.get('excludeStatus')

  const postsWhere = [
    from ? gte(socialMediaPosts.scheduledFor, from) : undefined,
    to ? lte(socialMediaPosts.scheduledFor, to) : undefined,
    excludeStatus ? ne(socialMediaPosts.status, excludeStatus) : undefined,
  ].filter(Boolean) as any[]

  const accounts = await db.query.socialMediaAccounts.findMany({
    where: and(eq(socialMediaAccounts.isActive, 1), eq(socialMediaAccounts.platform, 'x')),
    orderBy: [asc(socialMediaAccounts.label)],
  })

  const posts = await db.query.socialMediaPosts.findMany({
    where: postsWhere.length ? and(...postsWhere) : undefined,
    orderBy: [asc(socialMediaPosts.scheduledFor), asc(socialMediaPosts.postPk)],
  })

  const normalizedPosts = posts.map((p) => {
    const images = parseImageUrls(p.imageUrls ?? null, p.imageUrl ?? null)
    return {
      ...p,
      imageUrl: images[0] ?? null,
      images,
    }
  })

  return apiResponse({ accounts, posts: normalizedPosts })
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const now = new Date().toISOString()
  const status = parsed.data.status ?? 'suggested'
  const publishedAt = status === 'published' ? now : null

  const account = await db.query.socialMediaAccounts.findFirst({
    where: eq(socialMediaAccounts.id, parsed.data.accountId),
    columns: { id: true, platform: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `Social account ${parsed.data.accountId} not found`, 404)
  }
  if (parsed.data.platform && parsed.data.platform !== account.platform) {
    return apiError('VALIDATION_ERROR', `Account ${parsed.data.accountId} is on ${account.platform}, not ${parsed.data.platform}`, 400)
  }

  const images = (parsed.data.images && parsed.data.images.length > 0)
    ? parsed.data.images.slice(0, 4)
    : (parsed.data.imageUrl ? [parsed.data.imageUrl] : [])

  const inserted = await db.insert(socialMediaPosts).values({
    accountId: parsed.data.accountId,
    content: parsed.data.content,
    imageUrl: images[0] ?? null,
    imageUrls: JSON.stringify(images),
    hypothesis: parsed.data.hypothesis ?? null,
    variantLabel: parsed.data.variantLabel ?? null,
    experimentGroup: parsed.data.experimentGroup ?? null,
    scheduledFor: parsed.data.scheduledFor,
    status,
    externalPostId: null,
    quoteTweetId: parsed.data.quoteTweetId ?? null,
    publishedAt,
    createdBy: parsed.data.createdBy,
    createdAt: now,
    updatedAt: now,
  }).returning({
    postPk: socialMediaPosts.postPk,
  })

  return apiResponse({ postPk: inserted[0]?.postPk ?? null }, 201)
}
