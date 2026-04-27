import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  adsAccounts,
  adsCampaignDailyMetrics,
  adsCampaigns,
  adsCreativeDailyMetrics,
  socialMediaPosts,
} from '@/lib/db/schema'

type PublishJob = {
  jobPk: number
  providerId: string
  accountPk: number
  targetType: string
  targetPk: number
  action: string
  scheduledFor: string
  attempts: number
  maxAttempts: number
}

type XAdsPublishResult = {
  providerCampaignId: string
  response: unknown
  request: unknown
}

type XAdsAnalyticsSummary = {
  syncedCampaigns: number
  upserts: number
  errors: string[]
}

type ParsedAccountConfig = {
  advertiserAccountId: string | null
  socialAccountId: string | null
  dummyMode: boolean
}

function parseConfig(configJson: string | null): ParsedAccountConfig {
  if (!configJson) {
    return {
      advertiserAccountId: null,
      socialAccountId: null,
      dummyMode: false,
    }
  }

  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>
    return {
      advertiserAccountId: typeof parsed.advertiserAccountId === 'string' ? parsed.advertiserAccountId : null,
      socialAccountId: typeof parsed.socialAccountId === 'string' ? parsed.socialAccountId : null,
      dummyMode: parsed.dummyMode === 1 || parsed.dummyMode === true,
    }
  } catch {
    return {
      advertiserAccountId: null,
      socialAccountId: null,
      dummyMode: false,
    }
  }
}

function metricDateUtc(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function stableHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function ensureNumericTweetId(value: string): string {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid promoted tweet id "${value}"`)
  }
  return trimmed
}

async function resolvePromotedTweet(campaignPk: number): Promise<{
  promotedTweetId: string
  source: 'campaign' | 'social_post'
}> {
  const campaign = await db.query.adsCampaigns.findFirst({
    where: eq(adsCampaigns.campaignPk, campaignPk),
    columns: {
      promotedTweetId: true,
      socialPostPk: true,
    },
  })

  if (!campaign) throw new Error(`campaign ${campaignPk} not found`)

  if (campaign.promotedTweetId) {
    return {
      promotedTweetId: ensureNumericTweetId(campaign.promotedTweetId),
      source: 'campaign',
    }
  }

  if (!campaign.socialPostPk) {
    throw new Error(`campaign ${campaignPk} requires promotedTweetId or socialPostPk`)
  }

  const socialPost = await db.query.socialMediaPosts.findFirst({
    where: eq(socialMediaPosts.postPk, campaign.socialPostPk),
    columns: {
      postPk: true,
      externalPostId: true,
      status: true,
    },
  })

  if (!socialPost) throw new Error(`social post ${campaign.socialPostPk} not found`)
  if (!socialPost.externalPostId) {
    throw new Error(`social post ${campaign.socialPostPk} is not yet published to X`)
  }

  return {
    promotedTweetId: ensureNumericTweetId(socialPost.externalPostId),
    source: 'social_post',
  }
}

export async function publishXAdsCampaign(job: PublishJob): Promise<XAdsPublishResult> {
  const row = await db.select({
    campaignPk: adsCampaigns.campaignPk,
    providerCampaignId: adsCampaigns.providerCampaignId,
    name: adsCampaigns.name,
    startAt: adsCampaigns.startAt,
    endAt: adsCampaigns.endAt,
    budgetMode: adsCampaigns.budgetMode,
    budgetAmountCents: adsCampaigns.budgetAmountCents,
    targetingJson: adsCampaigns.targetingJson,
    productSku: adsCampaigns.productSku,
    destinationUrl: adsCampaigns.destinationUrl,
    promotedTweetId: adsCampaigns.promotedTweetId,
    socialPostPk: adsCampaigns.socialPostPk,
    accountExternalId: adsAccounts.accountExternalId,
    accountName: adsAccounts.accountName,
    configJson: adsAccounts.configJson,
  })
    .from(adsCampaigns)
    .innerJoin(adsAccounts, eq(adsAccounts.accountPk, adsCampaigns.accountPk))
    .where(and(
      eq(adsCampaigns.campaignPk, job.targetPk),
      eq(adsAccounts.accountPk, job.accountPk),
      eq(adsAccounts.providerId, 'x_ads'),
    ))
    .limit(1)

  const campaign = row[0]
  if (!campaign) {
    throw new Error(`campaign ${job.targetPk} not found for X Ads account ${job.accountPk}`)
  }

  if (campaign.providerCampaignId) {
    return {
      providerCampaignId: campaign.providerCampaignId,
      request: { skipped: 'already_has_provider_campaign_id' },
      response: { providerCampaignId: campaign.providerCampaignId },
    }
  }

  if (!campaign.budgetAmountCents || campaign.budgetAmountCents <= 0) {
    throw new Error(`campaign ${job.targetPk} requires a positive budgetAmountCents`)
  }

  const accountConfig = parseConfig(campaign.configJson)
  const tweet = await resolvePromotedTweet(campaign.campaignPk)
  const advertiserAccountId = accountConfig.advertiserAccountId ?? campaign.accountExternalId
  if (!advertiserAccountId) {
    throw new Error(`X Ads account ${job.accountPk} is missing advertiser account id`)
  }

  // First-pass implementation: keep production-safe behavior by defaulting the
  // seeded X Ads accounts to dummy mode until real Ads API access is available.
  if (!accountConfig.dummyMode) {
    throw new Error('X Ads API access is not configured yet; enable dummyMode or wire real credentials')
  }

  const providerCampaignId = `xcmp_${campaign.campaignPk}`
  const lineItemId = `xli_${campaign.campaignPk}`
  const promotedTweetRef = `xpt_${tweet.promotedTweetId.slice(-6)}`
  const now = new Date().toISOString()

  await db.update(adsCampaigns).set({
    providerCampaignId,
    promotedTweetId: tweet.promotedTweetId,
    status: 'paused',
    updatedAt: now,
  }).where(eq(adsCampaigns.campaignPk, campaign.campaignPk))

  return {
    providerCampaignId,
    request: {
      advertiserAccountId,
      accountName: campaign.accountName,
      objective: 'ENGAGEMENTS',
      productType: 'PROMOTED_TWEETS',
      promotedTweetId: tweet.promotedTweetId,
      source: tweet.source,
      startAt: campaign.startAt,
      endAt: campaign.endAt,
      budgetMode: campaign.budgetMode,
      budgetAmountCents: campaign.budgetAmountCents,
      targetingJson: campaign.targetingJson,
      destinationUrl: campaign.destinationUrl,
      productSku: campaign.productSku,
      dummyMode: true,
    },
    response: {
      campaign: {
        id: providerCampaignId,
        entity_status: 'PAUSED',
      },
      lineItem: {
        id: lineItemId,
        product_type: 'PROMOTED_TWEETS',
        objective: 'ENGAGEMENTS',
        entity_status: 'PAUSED',
      },
      promotedTweet: {
        id: promotedTweetRef,
        tweet_id: tweet.promotedTweetId,
        entity_status: 'ACTIVE',
        approval_status: 'ACCEPTED',
      },
    },
  }
}

export async function runXAdsAnalyticsSync(): Promise<XAdsAnalyticsSummary> {
  const now = new Date()
  const today = metricDateUtc(now)
  const errors: string[] = []

  const rows = await db.select({
    campaignPk: adsCampaigns.campaignPk,
    campaignName: adsCampaigns.name,
    accountPk: adsCampaigns.accountPk,
    providerCampaignId: adsCampaigns.providerCampaignId,
    promotedTweetId: adsCampaigns.promotedTweetId,
    socialPostPk: adsCampaigns.socialPostPk,
    configJson: adsAccounts.configJson,
  })
    .from(adsCampaigns)
    .innerJoin(adsAccounts, eq(adsAccounts.accountPk, adsCampaigns.accountPk))
    .where(and(
      eq(adsAccounts.providerId, 'x_ads'),
      sql`${adsCampaigns.providerCampaignId} is not null`,
      gte(sql`coalesce(${adsCampaigns.startAt}, '0001-01-01T00:00:00.000Z')`, '0001-01-01T00:00:00.000Z'),
      lte(sql`coalesce(${adsCampaigns.createdAt}, ${now.toISOString()})`, now.toISOString()),
    ))
    .orderBy(asc(adsCampaigns.campaignPk))

  let syncedCampaigns = 0
  let upserts = 0

  for (const row of rows) {
    try {
      const accountConfig = parseConfig(row.configJson)
      if (!accountConfig.dummyMode) continue

      const promotedTweet = row.promotedTweetId
        ? ensureNumericTweetId(row.promotedTweetId)
        : (await resolvePromotedTweet(row.campaignPk)).promotedTweetId
      const hash = stableHash(`${row.campaignPk}|${promotedTweet}|${today}`)
      const impressions = 400 + (hash % 2800)
      const clicks = Math.max(8, Math.round(impressions * (0.015 + ((hash % 20) / 1000))))
      const spendCents = clicks * (85 + (hash % 110))

      await db.insert(adsCampaignDailyMetrics).values({
        campaignPk: row.campaignPk,
        metricDate: today,
        providerId: 'x_ads',
        accountPk: row.accountPk,
        impressions,
        clicks,
        spendCents,
        conversions: 0,
        conversionValueCents: 0,
        sourceJson: JSON.stringify({
          mode: 'dummy',
          promotedTweetId: promotedTweet,
          providerCampaignId: row.providerCampaignId,
        }),
        updatedAt: now.toISOString(),
      }).onConflictDoUpdate({
        target: [adsCampaignDailyMetrics.campaignPk, adsCampaignDailyMetrics.metricDate],
        set: {
          providerId: 'x_ads',
          accountPk: row.accountPk,
          impressions,
          clicks,
          spendCents,
          conversions: 0,
          conversionValueCents: 0,
          sourceJson: JSON.stringify({
            mode: 'dummy',
            promotedTweetId: promotedTweet,
            providerCampaignId: row.providerCampaignId,
          }),
          updatedAt: now.toISOString(),
        },
      })

      await db.insert(adsCreativeDailyMetrics).values({
        campaignPk: row.campaignPk,
        metricDate: today,
        providerId: 'x_ads',
        accountPk: row.accountPk,
        creativeKey: promotedTweet,
        creativeName: `Promoted Tweet ${promotedTweet}`,
        creativePreviewUrl: null,
        impressions,
        clicks,
        spendCents,
        conversions: 0,
        conversionValueCents: 0,
        sourceJson: JSON.stringify({
          mode: 'dummy',
          promotedTweetId: promotedTweet,
          providerCampaignId: row.providerCampaignId,
        }),
        updatedAt: now.toISOString(),
      }).onConflictDoUpdate({
        target: [
          adsCreativeDailyMetrics.campaignPk,
          adsCreativeDailyMetrics.metricDate,
          adsCreativeDailyMetrics.creativeKey,
        ],
        set: {
          providerId: 'x_ads',
          accountPk: row.accountPk,
          creativeName: `Promoted Tweet ${promotedTweet}`,
          creativePreviewUrl: null,
          impressions,
          clicks,
          spendCents,
          conversions: 0,
          conversionValueCents: 0,
          sourceJson: JSON.stringify({
            mode: 'dummy',
            promotedTweetId: promotedTweet,
            providerCampaignId: row.providerCampaignId,
          }),
          updatedAt: now.toISOString(),
        },
      })

      syncedCampaigns += 1
      upserts += 2
    } catch (err) {
      errors.push(`campaignPk=${row.campaignPk}: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  return {
    syncedCampaigns,
    upserts,
    errors,
  }
}
