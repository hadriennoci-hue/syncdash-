import { and, asc, desc, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { socialAccountDailyMetrics, socialMediaAccounts, socialMediaPosts, socialPostDailyMetrics } from '@/lib/db/schema'
import { logOperation } from '@/lib/functions/log'
import { ingestSocialAnalytics } from '@/lib/functions/social-analytics-ingest'
import { xGetJson } from '@/lib/functions/social-x'
import type { TriggeredBy } from '@/types/platform'

type XTweetMetrics = {
  impression_count?: number
  like_count?: number
  retweet_count?: number
  reply_count?: number
  bookmark_count?: number
  quote_count?: number
}

type XTweet = {
  id: string
  text?: string
  public_metrics?: XTweetMetrics
  created_at?: string
}

type XTweetsLookupResponse = {
  data?: XTweet[]
  errors?: Array<{ value?: string; detail?: string; title?: string }>
}

type XUserLookupResponse = {
  data?: {
    id?: string
    username?: string
    public_metrics?: {
      followers_count?: number
      following_count?: number
      tweet_count?: number
      listed_count?: number
    }
  }
}

type SyncSummary = {
  scannedPosts: number
  syncedPosts: number
  syncedAccounts: number
  accountDailyUpserts: number
  postDailyUpserts: number
  errors: string[]
}

function ymdUtc(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function metricDelta(current: number | undefined, previous: number | null | undefined): number {
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

async function fetchTweetsByIds(accountId: string, ids: string[]): Promise<Map<string, XTweet>> {
  const out = new Map<string, XTweet>()
  for (const batch of chunk(ids, 100)) {
    const url = new URL(process.env.X_API_TWEETS_LOOKUP_URL ?? 'https://api.twitter.com/2/tweets')
    url.searchParams.set('ids', batch.join(','))
    url.searchParams.set('tweet.fields', 'public_metrics,created_at')
    const json = await xGetJson<XTweetsLookupResponse>(accountId, url.toString())
    for (const row of json.data ?? []) {
      if (row.id) out.set(row.id, row)
    }
  }
  return out
}

async function fetchAccountMetrics(accountId: string): Promise<XUserLookupResponse['data'] | null> {
  const url = new URL(process.env.X_API_ME_URL ?? 'https://api.twitter.com/2/users/me')
  url.searchParams.set('user.fields', 'public_metrics,username')
  const json = await xGetJson<XUserLookupResponse>(accountId, url.toString())
  return json.data ?? null
}

export async function runSocialAnalyticsSync(triggeredBy: TriggeredBy = 'system'): Promise<SyncSummary> {
  const metricDate = ymdUtc(new Date())
  const errors: string[] = []

  const publishedPosts = await db
    .select({
      postPk: socialMediaPosts.postPk,
      accountId: socialMediaPosts.accountId,
      externalPostId: socialMediaPosts.externalPostId,
      publishedAt: socialMediaPosts.publishedAt,
    })
    .from(socialMediaPosts)
    .innerJoin(socialMediaAccounts, eq(socialMediaAccounts.id, socialMediaPosts.accountId))
    .where(and(
      eq(socialMediaAccounts.platform, 'x'),
      eq(socialMediaAccounts.isActive, 1),
      eq(socialMediaPosts.status, 'published'),
      isNotNull(socialMediaPosts.externalPostId),
    ))
    .orderBy(asc(socialMediaPosts.accountId), asc(socialMediaPosts.postPk))

  const byAccount = new Map<string, typeof publishedPosts>()
  for (const row of publishedPosts) {
    const current = byAccount.get(row.accountId) ?? []
    current.push(row)
    byAccount.set(row.accountId, current)
  }

  let syncedPosts = 0
  let syncedAccounts = 0
  let accountDailyUpserts = 0
  let postDailyUpserts = 0

  for (const [accountId, posts] of byAccount.entries()) {
    try {
      const ids = posts.map((row) => row.externalPostId).filter((id): id is string => !!id)
      const tweetMap = await fetchTweetsByIds(accountId, ids)
      const accountMetrics = await fetchAccountMetrics(accountId)

      const previousPostRows = await db.query.socialPostDailyMetrics.findMany({
        where: lt(socialPostDailyMetrics.metricDate, metricDate),
        orderBy: [desc(socialPostDailyMetrics.metricDate)],
      })
      const previousByPostPk = new Map<number, typeof previousPostRows[number]>()
      for (const row of previousPostRows) {
        if (!posts.some((p) => p.postPk === row.postPk)) continue
        if (!previousByPostPk.has(row.postPk)) previousByPostPk.set(row.postPk, row)
      }

      const previousAccount = await db.query.socialAccountDailyMetrics.findFirst({
        where: and(
          eq(socialAccountDailyMetrics.accountId, accountId),
          lt(socialAccountDailyMetrics.metricDate, metricDate),
        ),
        orderBy: [desc(socialAccountDailyMetrics.metricDate)],
      })

      const postDailyMetrics = posts
        .map((post) => {
          const tweet = post.externalPostId ? tweetMap.get(post.externalPostId) : undefined
          if (!tweet?.id) return null
          const prev = previousByPostPk.get(post.postPk)
          const current = tweet.public_metrics ?? {}
          return {
            postPk: post.postPk,
            externalPostId: tweet.id,
            metricDate,
            impressions: metricDelta(current.impression_count, prev?.impressions),
            likes: metricDelta(current.like_count, prev?.likes),
            reposts: metricDelta(current.retweet_count, prev?.reposts),
            replies: metricDelta(current.reply_count, prev?.replies),
            bookmarks: metricDelta(current.bookmark_count, prev?.bookmarks),
            quotes: metricDelta(current.quote_count, prev?.quotes),
            profileClicks: 0,
            linkClicks: 0,
            followerDelta24h: null,
            followerDelta72h: null,
            sentimentTag: null,
            reasonTags: [],
            source: {
              tweetId: tweet.id,
              createdAt: tweet.created_at ?? null,
              public_metrics: current,
            },
          }
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)

      const accountImpressions = postDailyMetrics.reduce((sum, row) => sum + row.impressions, 0)
      const accountEngagements = postDailyMetrics.reduce((sum, row) => sum + row.likes + row.reposts + row.replies + row.bookmarks + row.quotes, 0)
      const followersTotal = accountMetrics?.public_metrics?.followers_count ?? null
      const followersDelta = followersTotal != null
        ? metricDelta(followersTotal, previousAccount?.followersTotal)
        : 0
      const postsPublishedToday = posts.filter((post) => (post.publishedAt ?? '').slice(0, 10) === metricDate).length

      const ingestResult = await ingestSocialAnalytics({
        accountId,
        accountDailyMetrics: [{
          metricDate,
          impressions: accountImpressions,
          engagements: accountEngagements,
          linkClicks: 0,
          followersTotal,
          followersDelta,
          postsPublished: postsPublishedToday,
          source: {
            username: accountMetrics?.username ?? null,
            userId: accountMetrics?.id ?? null,
            public_metrics: accountMetrics?.public_metrics ?? null,
          },
        }],
        postDailyMetrics,
      })

      syncedAccounts += 1
      syncedPosts += postDailyMetrics.length
      accountDailyUpserts += ingestResult.accountDailyUpserts
      postDailyUpserts += ingestResult.postDailyUpserts

      await logOperation({
        platform: 'x',
        action: 'social_analytics_sync',
        status: 'success',
        message: `account=${accountId} posts=${postDailyMetrics.length} followers=${followersTotal ?? 'n/a'}`,
        triggeredBy,
      })
    } catch (err) {
      const message = `account=${accountId} failed: ${err instanceof Error ? err.message : 'unknown error'}`
      errors.push(message)
      await logOperation({
        platform: 'x',
        action: 'social_analytics_sync',
        status: 'error',
        message,
        triggeredBy,
      })
    }
  }

  return {
    scannedPosts: publishedPosts.length,
    syncedPosts,
    syncedAccounts,
    accountDailyUpserts,
    postDailyUpserts,
    errors,
  }
}
