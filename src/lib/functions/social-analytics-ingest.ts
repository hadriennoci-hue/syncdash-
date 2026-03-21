import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { socialAccountDailyMetrics, socialMediaPosts, socialPostDailyMetrics } from '@/lib/db/schema'

export interface SocialAccountDailyMetricInput {
  metricDate: string
  impressions: number
  engagements: number
  linkClicks: number
  followersTotal?: number | null
  followersDelta: number
  postsPublished: number
  source?: Record<string, unknown>
}

export interface SocialPostDailyMetricInput {
  postPk?: number
  externalPostId?: string | null
  metricDate: string
  impressions: number
  likes: number
  reposts: number
  replies: number
  bookmarks: number
  quotes: number
  profileClicks: number
  linkClicks: number
  followerDelta24h?: number | null
  followerDelta72h?: number | null
  sentimentTag?: 'positive' | 'neutral' | 'negative' | 'unknown' | null
  reasonTags?: string[]
  hypothesis?: string
  variantLabel?: string
  experimentGroup?: string
  source?: Record<string, unknown>
}

export interface SocialAnalyticsIngestPayload {
  accountId: string
  accountDailyMetrics: SocialAccountDailyMetricInput[]
  postDailyMetrics: SocialPostDailyMetricInput[]
}

export async function ingestSocialAnalytics(payload: SocialAnalyticsIngestPayload): Promise<{
  accountDailyUpserts: number
  postDailyUpserts: number
}> {
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
      throw new Error(`post not found for account ${payload.accountId} (postPk=${row.postPk ?? '-'}, externalPostId=${row.externalPostId ?? '-'})`)
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

  return { accountDailyUpserts, postDailyUpserts }
}
