import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { adsAccounts, adsCampaigns, adsPublishJobs } from '@/lib/db/schema'
import { logOperation } from '@/lib/functions/log'
import { getGoogleAdsAccessToken } from '@/lib/functions/google-ads'

type AdsPublishSummary = {
  enabled: boolean
  scanned: number
  published: number
  failed: number
  skipped: number
  errors: string[]
}

type GoogleMutateResponse = {
  results?: Array<{ resourceName?: string }>
  partialFailureError?: {
    message?: string
  }
}

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

function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, '').trim()
}

function googleAdsApiVersion(): string {
  return process.env.GOOGLE_ADS_API_VERSION || 'v18'
}

function googleAdsHeaders(accessToken: string): Record<string, string> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  if (!developerToken) {
    throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN')
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': developerToken,
  }

  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '').trim()
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId
  }

  return headers
}

async function googleAdsMutate(customerId: string, resource: string, body: unknown, accessToken: string): Promise<GoogleMutateResponse> {
  const res = await fetch(
    `https://googleads.googleapis.com/${googleAdsApiVersion()}/customers/${normalizeCustomerId(customerId)}/${resource}:mutate`,
    {
      method: 'POST',
      headers: googleAdsHeaders(accessToken),
      body: JSON.stringify(body),
    }
  )

  const bodyText = await res.text()
  let parsed: GoogleMutateResponse = {}
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as GoogleMutateResponse) : {}
  } catch {
    // Keep raw text for the error path.
  }

  if (!res.ok) {
    throw new Error(`Google Ads ${resource}:mutate failed ${res.status}: ${bodyText.slice(0, 500)}`)
  }

  if (parsed.partialFailureError?.message) {
    throw new Error(`Google Ads ${resource}:mutate partial failure: ${parsed.partialFailureError.message}`)
  }

  return parsed
}

function requireResourceName(response: GoogleMutateResponse, label: string): string {
  const resourceName = response.results?.[0]?.resourceName?.trim()
  if (!resourceName) {
    throw new Error(`Google Ads ${label} mutate succeeded without resourceName`)
  }
  return resourceName
}

function centsToMicros(cents: number): number {
  return cents * 10_000
}

function isoToGoogleDate(value: string | null, fallbackDaysFromNow: number): string {
  const date = value ? new Date(value) : new Date(Date.now() + fallbackDaysFromNow * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date(Date.now() + fallbackDaysFromNow * 24 * 60 * 60 * 1000)
    return fallback.toISOString().slice(0, 10)
  }
  return date.toISOString().slice(0, 10)
}

function extractResourceId(resourceName: string): string {
  return resourceName.split('/').pop() ?? resourceName
}

async function publishGoogleAdsCampaign(job: PublishJob): Promise<{ providerCampaignId: string; response: unknown; request: unknown }> {
  const row = await db.select({
    campaignPk: adsCampaigns.campaignPk,
    providerCampaignId: adsCampaigns.providerCampaignId,
    name: adsCampaigns.name,
    startAt: adsCampaigns.startAt,
    endAt: adsCampaigns.endAt,
    budgetAmountCents: adsCampaigns.budgetAmountCents,
    destinationUrl: adsCampaigns.destinationUrl,
    destinationPending: adsCampaigns.destinationPending,
    accountExternalId: adsAccounts.accountExternalId,
  })
    .from(adsCampaigns)
    .innerJoin(adsAccounts, eq(adsAccounts.accountPk, adsCampaigns.accountPk))
    .where(and(
      eq(adsCampaigns.campaignPk, job.targetPk),
      eq(adsAccounts.accountPk, job.accountPk),
      eq(adsAccounts.providerId, 'google_ads'),
    ))
    .limit(1)

  const campaign = row[0]
  if (!campaign) {
    throw new Error(`campaign ${job.targetPk} not found for Google Ads account ${job.accountPk}`)
  }
  if (campaign.providerCampaignId) {
    return {
      providerCampaignId: campaign.providerCampaignId,
      request: { skipped: 'already_has_provider_campaign_id' },
      response: { providerCampaignId: campaign.providerCampaignId },
    }
  }
  if (campaign.destinationPending === 1 || !campaign.destinationUrl) {
    throw new Error(`campaign ${job.targetPk} cannot publish while destination is pending`)
  }
  if (!campaign.budgetAmountCents || campaign.budgetAmountCents <= 0) {
    throw new Error(`campaign ${job.targetPk} requires a positive budgetAmountCents`)
  }

  const customerId = normalizeCustomerId(campaign.accountExternalId)
  if (!/^\d+$/.test(customerId)) {
    throw new Error(`Google Ads account ${job.accountPk} has invalid customer id "${campaign.accountExternalId}"`)
  }

  const accessToken = await getGoogleAdsAccessToken(true)
  const suffix = `${campaign.campaignPk}-${Date.now()}`
  const budgetRequest = {
    operations: [{
      create: {
        name: `${campaign.name} budget ${suffix}`,
        deliveryMethod: 'STANDARD',
        amountMicros: centsToMicros(campaign.budgetAmountCents),
      },
    }],
  }
  const budgetResponse = await googleAdsMutate(customerId, 'campaignBudgets', budgetRequest, accessToken)
  const budgetResourceName = requireResourceName(budgetResponse, 'campaign budget')

  const campaignRequest = {
    operations: [{
      create: {
        campaignBudget: budgetResourceName,
        name: `${campaign.name} ${suffix}`,
        advertisingChannelType: 'SEARCH',
        status: 'PAUSED',
        manualCpc: {},
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: true,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        startDate: isoToGoogleDate(campaign.startAt, 1),
        endDate: isoToGoogleDate(campaign.endAt, 30),
        finalUrlSuffix: `utm_source=google&utm_medium=cpc&utm_campaign=${encodeURIComponent(campaign.name)}`,
      },
    }],
  }
  const campaignResponse = await googleAdsMutate(customerId, 'campaigns', campaignRequest, accessToken)
  const campaignResourceName = requireResourceName(campaignResponse, 'campaign')
  const providerCampaignId = extractResourceId(campaignResourceName)
  const now = new Date().toISOString()

  await db.update(adsCampaigns).set({
    providerCampaignId,
    status: 'paused',
    updatedAt: now,
  }).where(eq(adsCampaigns.campaignPk, campaign.campaignPk))

  return {
    providerCampaignId,
    request: { budgetRequest, campaignRequest },
    response: { budgetResponse, campaignResponse },
  }
}

async function markJob(jobPk: number, status: string, patch: {
  lastError?: string | null
  requestJson?: string | null
  responseJson?: string | null
  startedAt?: string | null
  finishedAt?: string | null
} = {}): Promise<void> {
  await db.update(adsPublishJobs).set({
    status,
    ...patch,
    updatedAt: new Date().toISOString(),
  }).where(eq(adsPublishJobs.jobPk, jobPk))
}

export async function runAdsPublishCron(): Promise<AdsPublishSummary> {
  const enabled = process.env.GOOGLE_ADS_PUBLISH_ENABLED === '1'
  const errors: string[] = []
  if (!enabled) {
    return { enabled, scanned: 0, published: 0, failed: 0, skipped: 0, errors }
  }

  const now = new Date().toISOString()
  const dueJobs = await db.select({
    jobPk: adsPublishJobs.jobPk,
    providerId: adsPublishJobs.providerId,
    accountPk: adsPublishJobs.accountPk,
    targetType: adsPublishJobs.targetType,
    targetPk: adsPublishJobs.targetPk,
    action: adsPublishJobs.action,
    scheduledFor: adsPublishJobs.scheduledFor,
    attempts: adsPublishJobs.attempts,
    maxAttempts: adsPublishJobs.maxAttempts,
  })
    .from(adsPublishJobs)
    .where(and(
      eq(adsPublishJobs.status, 'queued'),
      lte(adsPublishJobs.scheduledFor, now),
      sql`${adsPublishJobs.attempts} < ${adsPublishJobs.maxAttempts}`,
    ))
    .orderBy(asc(adsPublishJobs.scheduledFor), asc(adsPublishJobs.jobPk))

  let published = 0
  let failed = 0
  let skipped = 0

  for (const job of dueJobs) {
    if (job.providerId !== 'google_ads' || job.targetType !== 'campaign' || job.action !== 'publish') {
      skipped += 1
      await markJob(job.jobPk, 'error', {
        lastError: `Unsupported ads publish job provider=${job.providerId} targetType=${job.targetType} action=${job.action}`,
        finishedAt: new Date().toISOString(),
      })
      continue
    }

    const startedAt = new Date().toISOString()
    await db.update(adsPublishJobs).set({
      status: 'running',
      attempts: job.attempts + 1,
      startedAt,
      lastError: null,
      updatedAt: startedAt,
    }).where(eq(adsPublishJobs.jobPk, job.jobPk))

    try {
      const result = await publishGoogleAdsCampaign(job)
      const finishedAt = new Date().toISOString()
      await markJob(job.jobPk, 'success', {
        requestJson: JSON.stringify(result.request),
        responseJson: JSON.stringify(result.response),
        finishedAt,
      })
      published += 1
      await logOperation({
        platform: 'google_ads',
        action: 'ads_publish',
        status: 'success',
        message: `jobPk=${job.jobPk} campaignPk=${job.targetPk} providerCampaignId=${result.providerCampaignId}`,
        triggeredBy: 'system',
      })
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`jobPk=${job.jobPk}: ${message}`)
      const attempts = job.attempts + 1
      await markJob(job.jobPk, attempts >= job.maxAttempts ? 'error' : 'queued', {
        lastError: message,
        finishedAt: new Date().toISOString(),
      })
      await logOperation({
        platform: 'google_ads',
        action: 'ads_publish',
        status: 'error',
        message: `jobPk=${job.jobPk} campaignPk=${job.targetPk}: ${message}`,
        triggeredBy: 'system',
      })
    }
  }

  return {
    enabled,
    scanned: dueJobs.length,
    published,
    failed,
    skipped,
    errors,
  }
}
