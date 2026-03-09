import { NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { adsAccounts, adsCampaigns, adsCreativeDailyMetrics, adsSegmentDailyMetrics } from '@/lib/db/schema'

const creativeMetricSchema = z.object({
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignPk: z.number().int().positive(),
  creativeKey: z.string().min(1).max(255),
  creativeName: z.string().max(255).optional(),
  creativePreviewUrl: z.string().url().optional(),
  impressions: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  spendCents: z.number().int().nonnegative().default(0),
  conversions: z.number().int().nonnegative().default(0),
  conversionValueCents: z.number().int().nonnegative().default(0),
  source: z.record(z.any()).optional(),
})

const segmentMetricSchema = z.object({
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignPk: z.number().int().positive(),
  segmentType: z.enum(['audience', 'placement', 'device', 'geography', 'other']),
  segmentValue: z.string().min(1).max(255),
  impressions: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  spendCents: z.number().int().nonnegative().default(0),
  conversions: z.number().int().nonnegative().default(0),
  conversionValueCents: z.number().int().nonnegative().default(0),
  source: z.record(z.any()).optional(),
})

const bodySchema = z.object({
  providerId: z.enum(['google_ads', 'meta_ads', 'tiktok_ads']),
  accountPk: z.number().int().positive(),
  creativeMetrics: z.array(creativeMetricSchema).default([]),
  segmentMetrics: z.array(segmentMetricSchema).default([]),
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
  const account = await db.query.adsAccounts.findFirst({
    where: and(
      eq(adsAccounts.accountPk, payload.accountPk),
      eq(adsAccounts.providerId, payload.providerId),
    ),
    columns: { accountPk: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `ads account ${payload.accountPk} for provider ${payload.providerId} not found`, 404)
  }

  const campaignIds = Array.from(new Set([
    ...payload.creativeMetrics.map((m) => m.campaignPk),
    ...payload.segmentMetrics.map((m) => m.campaignPk),
  ]))

  for (const campaignPk of campaignIds) {
    const campaign = await db.query.adsCampaigns.findFirst({
      where: and(
        eq(adsCampaigns.campaignPk, campaignPk),
        eq(adsCampaigns.accountPk, payload.accountPk),
      ),
      columns: { campaignPk: true },
    })
    if (!campaign) {
      return apiError('NOT_FOUND', `campaign ${campaignPk} not found on account ${payload.accountPk}`, 404)
    }
  }

  const now = new Date().toISOString()
  let creativeUpserts = 0
  let segmentUpserts = 0

  for (const metric of payload.creativeMetrics) {
    await db.insert(adsCreativeDailyMetrics).values({
      campaignPk: metric.campaignPk,
      metricDate: metric.metricDate,
      providerId: payload.providerId,
      accountPk: payload.accountPk,
      creativeKey: metric.creativeKey,
      creativeName: metric.creativeName ?? null,
      creativePreviewUrl: metric.creativePreviewUrl ?? null,
      impressions: metric.impressions,
      clicks: metric.clicks,
      spendCents: metric.spendCents,
      conversions: metric.conversions,
      conversionValueCents: metric.conversionValueCents,
      sourceJson: metric.source ? JSON.stringify(metric.source) : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        adsCreativeDailyMetrics.campaignPk,
        adsCreativeDailyMetrics.metricDate,
        adsCreativeDailyMetrics.creativeKey,
      ],
      set: {
        providerId: payload.providerId,
        accountPk: payload.accountPk,
        creativeName: metric.creativeName ?? null,
        creativePreviewUrl: metric.creativePreviewUrl ?? null,
        impressions: metric.impressions,
        clicks: metric.clicks,
        spendCents: metric.spendCents,
        conversions: metric.conversions,
        conversionValueCents: metric.conversionValueCents,
        sourceJson: metric.source ? JSON.stringify(metric.source) : null,
        updatedAt: now,
      },
    })
    creativeUpserts++
  }

  for (const metric of payload.segmentMetrics) {
    await db.insert(adsSegmentDailyMetrics).values({
      campaignPk: metric.campaignPk,
      metricDate: metric.metricDate,
      providerId: payload.providerId,
      accountPk: payload.accountPk,
      segmentType: metric.segmentType,
      segmentValue: metric.segmentValue,
      impressions: metric.impressions,
      clicks: metric.clicks,
      spendCents: metric.spendCents,
      conversions: metric.conversions,
      conversionValueCents: metric.conversionValueCents,
      sourceJson: metric.source ? JSON.stringify(metric.source) : null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        adsSegmentDailyMetrics.campaignPk,
        adsSegmentDailyMetrics.metricDate,
        adsSegmentDailyMetrics.segmentType,
        adsSegmentDailyMetrics.segmentValue,
      ],
      set: {
        providerId: payload.providerId,
        accountPk: payload.accountPk,
        impressions: metric.impressions,
        clicks: metric.clicks,
        spendCents: metric.spendCents,
        conversions: metric.conversions,
        conversionValueCents: metric.conversionValueCents,
        sourceJson: metric.source ? JSON.stringify(metric.source) : null,
        updatedAt: now,
      },
    })
    segmentUpserts++
  }

  return apiResponse({
    ok: true,
    creativeUpserts,
    segmentUpserts,
  })
}
