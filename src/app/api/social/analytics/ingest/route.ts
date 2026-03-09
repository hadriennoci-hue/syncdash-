import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialAccountDailyMetrics, socialMediaAccounts, socialMediaPosts, socialPostDailyMetrics } from '@/lib/db/schema'

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

  const now = new Date().toISOString()
  let accountDailyUpserts = 0
  let postDailyUpserts = 0

  for (const row of payload.accountDailyMetrics) {
    await db.insert(socialAccountDailyMetrics).values({
      accountId: payload.accountId,
      metricDate: row.metricDate,
      impressions: row.impressions,
      engagements: row.engagements,
      linkClicks: row.linkClicks,
      followersTotal: row.followersTotal ?? null,
      followersDelta: row.followersDelta,
      postsPublished: row.postsPublished,
      sourceJson: row.source ? JSON.stringify(row.source) : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [socialAccountDailyMetrics.accountId, socialAccountDailyMetrics.metricDate],
      set: {
        impressions: row.impressions,
        engagements: row.engagements,
        linkClicks: row.linkClicks,
        followersTotal: row.followersTotal ?? null,
        followersDelta: row.followersDelta,
        postsPublished: row.postsPublished,
        sourceJson: row.source ? JSON.stringify(row.source) : null,
        updatedAt: now,
      },
    })
    accountDailyUpserts++
  }

  for (const row of payload.postDailyMetrics) {
    const post = row.postPk
      ? await db.query.socialMediaPosts.findFirst({
        where: and(
          eq(socialMediaPosts.postPk, row.postPk),
          eq(socialMediaPosts.accountId, payload.accountId),
        ),
      })
      : await db.query.socialMediaPosts.findFirst({
        where: and(
          eq(socialMediaPosts.accountId, payload.accountId),
          eq(socialMediaPosts.externalPostId, row.externalPostId ?? ''),
        ),
      })

    if (!post) {
      return apiError('NOT_FOUND', `post not found for account ${payload.accountId} (postPk=${row.postPk ?? '-'}, externalPostId=${row.externalPostId ?? '-'})`, 404)
    }

    await db.insert(socialPostDailyMetrics).values({
      postPk: post.postPk,
      metricDate: row.metricDate,
      impressions: row.impressions,
      likes: row.likes,
      reposts: row.reposts,
      replies: row.replies,
      bookmarks: row.bookmarks,
      quotes: row.quotes,
      profileClicks: row.profileClicks,
      linkClicks: row.linkClicks,
      followerDelta24h: row.followerDelta24h ?? null,
      followerDelta72h: row.followerDelta72h ?? null,
      sentimentTag: row.sentimentTag ?? null,
      reasonTagsJson: row.reasonTags ? JSON.stringify(row.reasonTags) : null,
      sourceJson: row.source ? JSON.stringify(row.source) : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [socialPostDailyMetrics.postPk, socialPostDailyMetrics.metricDate],
      set: {
        impressions: row.impressions,
        likes: row.likes,
        reposts: row.reposts,
        replies: row.replies,
        bookmarks: row.bookmarks,
        quotes: row.quotes,
        profileClicks: row.profileClicks,
        linkClicks: row.linkClicks,
        followerDelta24h: row.followerDelta24h ?? null,
        followerDelta72h: row.followerDelta72h ?? null,
        sentimentTag: row.sentimentTag ?? null,
        reasonTagsJson: row.reasonTags ? JSON.stringify(row.reasonTags) : null,
        sourceJson: row.source ? JSON.stringify(row.source) : null,
        updatedAt: now,
      },
    })

    if (row.hypothesis || row.variantLabel || row.experimentGroup) {
      await db.update(socialMediaPosts).set({
        hypothesis: row.hypothesis ?? undefined,
        variantLabel: row.variantLabel ?? undefined,
        experimentGroup: row.experimentGroup ?? undefined,
        updatedAt: now,
      }).where(eq(socialMediaPosts.postPk, post.postPk))
    }

    postDailyUpserts++
  }

  return apiResponse({
    ok: true,
    accountDailyUpserts,
    postDailyUpserts,
  })
}
