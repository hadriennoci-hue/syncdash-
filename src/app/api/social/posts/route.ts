import { NextRequest } from 'next/server'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialMediaAccounts, socialMediaPosts } from '@/lib/db/schema'

const statusSchema = z.enum(['suggested', 'validated', 'canceled', 'published'])

const createSchema = z.object({
  accountId: z.string().min(1),
  content: z.string().min(1).max(500),
  imageUrl: z.string().url().optional(),
  scheduledFor: z.string().datetime(),
  status: statusSchema.optional(),
  createdBy: z.enum(['agent', 'human', 'system']).default('agent'),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  const postsWhere = [
    from ? gte(socialMediaPosts.scheduledFor, from) : undefined,
    to ? lte(socialMediaPosts.scheduledFor, to) : undefined,
  ].filter(Boolean) as any[]

  const accounts = await db.query.socialMediaAccounts.findMany({
    where: and(eq(socialMediaAccounts.isActive, 1), eq(socialMediaAccounts.platform, 'x')),
    orderBy: [asc(socialMediaAccounts.label)],
  })

  const posts = await db.query.socialMediaPosts.findMany({
    where: postsWhere.length ? and(...postsWhere) : undefined,
    orderBy: [asc(socialMediaPosts.scheduledFor), asc(socialMediaPosts.postPk)],
  })

  return apiResponse({ accounts, posts })
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
    columns: { id: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `Social account ${parsed.data.accountId} not found`, 404)
  }

  const inserted = await db.insert(socialMediaPosts).values({
    accountId: parsed.data.accountId,
    content: parsed.data.content,
    imageUrl: parsed.data.imageUrl ?? null,
    scheduledFor: parsed.data.scheduledFor,
    status,
    externalPostId: null,
    publishedAt,
    createdBy: parsed.data.createdBy,
    createdAt: now,
    updatedAt: now,
  }).returning({
    postPk: socialMediaPosts.postPk,
  })

  return apiResponse({ postPk: inserted[0]?.postPk ?? null }, 201)
}
