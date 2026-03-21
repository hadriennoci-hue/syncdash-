import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialMediaAccounts } from '@/lib/db/schema'
import { ingestSocialAnalytics } from '@/lib/functions/social-analytics-ingest'

const accountDailySchema = z.object({
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: z.number().int().nonnegative().default(0),
  engagements: z.number().int().nonnegative().default(0),
  linkClicks: z.number().int().nonnegative().default(0),
  followersTotal: z.number().int().optional(),
  followersDelta: z.number().int().default(0),
  postsPublished: z.number().int().nonnegative().default(0),
  source: z.record(z.any()).optional(),
})

const postDailySchema = z.object({
  postPk: z.number().int().positive().optional(),
  externalPostId: z.string().min(1).optional(),
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  impressions: z.number().int().nonnegative().default(0),
  likes: z.number().int().nonnegative().default(0),
  reposts: z.number().int().nonnegative().default(0),
  replies: z.number().int().nonnegative().default(0),
  bookmarks: z.number().int().nonnegative().default(0),
  quotes: z.number().int().nonnegative().default(0),
  profileClicks: z.number().int().nonnegative().default(0),
  linkClicks: z.number().int().nonnegative().default(0),
  followerDelta24h: z.number().int().optional(),
  followerDelta72h: z.number().int().optional(),
  sentimentTag: z.enum(['positive', 'neutral', 'negative', 'unknown']).optional(),
  reasonTags: z.array(z.string().min(1).max(80)).max(10).optional(),
  hypothesis: z.string().max(500).optional(),
  variantLabel: z.string().max(120).optional(),
  experimentGroup: z.string().max(120).optional(),
  source: z.record(z.any()).optional(),
})

const bodySchema = z.object({
  accountId: z.string().min(1),
  platform: z.enum(['x', 'instagram']).optional(),
  accountDailyMetrics: z.array(accountDailySchema).default([]),
  postDailyMetrics: z.array(postDailySchema).default([]),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const payload = parsed.data
  const account = await db.query.socialMediaAccounts.findFirst({
    where: eq(socialMediaAccounts.id, payload.accountId),
    columns: { id: true, platform: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `social account ${payload.accountId} not found`, 404)
  }
  if (payload.platform && payload.platform !== account.platform) {
    return apiError('VALIDATION_ERROR', `Account ${payload.accountId} is on ${account.platform}, not ${payload.platform}`, 400)
  }

  try {
    const result = await ingestSocialAnalytics({
      accountId: payload.accountId,
      accountDailyMetrics: payload.accountDailyMetrics,
      postDailyMetrics: payload.postDailyMetrics,
    })
    return apiResponse({
      ok: true,
      accountDailyUpserts: result.accountDailyUpserts,
      postDailyUpserts: result.postDailyUpserts,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingest failed'
    if (message.includes('post not found for account')) {
      return apiError('NOT_FOUND', message, 404)
    }
    return apiError('INGEST_ERROR', message, 500)
  }
}
