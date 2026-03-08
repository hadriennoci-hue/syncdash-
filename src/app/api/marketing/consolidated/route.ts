import { NextRequest } from 'next/server'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { verifyAdsReadBearer } from '@/lib/auth/ads-bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import {
  googleAdsAdGroups,
  googleAdsCampaigns,
  salesOrderAttribution,
  salesOrderMarketing,
  salesOrders,
} from '@/lib/db/schema'

function asInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

// GET /api/marketing/consolidated
// Read-only endpoint for ads reporting agent.
export async function GET(req: NextRequest) {
  const auth = verifyAdsReadBearer(req)
  if (auth) return auth

  try {
    const from = req.nextUrl.searchParams.get('from') // YYYY-MM-DD or ISO
    const to = req.nextUrl.searchParams.get('to')
    const limit = Math.min(Math.max(asInt(req.nextUrl.searchParams.get('limit'), 200), 1), 1000)
    const offset = Math.max(asInt(req.nextUrl.searchParams.get('offset'), 0), 0)
    const channelId = req.nextUrl.searchParams.get('channelId')
    const attributionModel = req.nextUrl.searchParams.get('model')

    const conditions = []
    if (from) conditions.push(gte(salesOrders.orderCreatedAt, from))
    if (to) conditions.push(lte(salesOrders.orderCreatedAt, to))
    if (channelId) conditions.push(eq(salesOrders.channelId, channelId))
    if (attributionModel) conditions.push(eq(salesOrderAttribution.model, attributionModel))

    const rows = await db.select({
      orderPk: salesOrders.orderPk,
      channelId: salesOrders.channelId,
      platform: salesOrders.platform,
      externalOrderId: salesOrders.externalOrderId,
      externalOrderName: salesOrders.externalOrderName,
      orderCreatedAt: salesOrders.orderCreatedAt,
      currencyCode: salesOrders.currencyCode,
      totalAmountCents: salesOrders.totalAmountCents,
      refundedAmountCents: salesOrders.refundedAmountCents,
      netAmountCents: salesOrders.netAmountCents,
      utmSource: salesOrderMarketing.utmSource,
      utmMedium: salesOrderMarketing.utmMedium,
      utmCampaign: salesOrderMarketing.utmCampaign,
      gclid: salesOrderMarketing.gclid,
      attributionModel: salesOrderAttribution.model,
      attributionConfidence: salesOrderAttribution.confidence,
      googleCustomerId: salesOrderAttribution.googleCustomerId,
      campaignId: salesOrderAttribution.campaignId,
      campaignName: googleAdsCampaigns.name,
      adGroupId: salesOrderAttribution.adGroupId,
      adGroupName: googleAdsAdGroups.name,
      clickTime: salesOrderAttribution.clickTime,
      attributedAt: salesOrderAttribution.attributedAt,
    })
      .from(salesOrders)
      .leftJoin(salesOrderMarketing, eq(salesOrderMarketing.orderPk, salesOrders.orderPk))
      .leftJoin(salesOrderAttribution, eq(salesOrderAttribution.orderPk, salesOrders.orderPk))
      .leftJoin(
        googleAdsCampaigns,
        and(
          eq(googleAdsCampaigns.customerId, salesOrderAttribution.googleCustomerId),
          eq(googleAdsCampaigns.campaignId, salesOrderAttribution.campaignId)
        )
      )
      .leftJoin(
        googleAdsAdGroups,
        and(
          eq(googleAdsAdGroups.customerId, salesOrderAttribution.googleCustomerId),
          eq(googleAdsAdGroups.adGroupId, salesOrderAttribution.adGroupId)
        )
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(salesOrders.orderCreatedAt), desc(salesOrders.orderPk))
      .limit(limit)
      .offset(offset)

    const [{ count }] = await db.select({
      count: sql<number>`count(*)`,
    }).from(salesOrders)
      .leftJoin(salesOrderAttribution, eq(salesOrderAttribution.orderPk, salesOrders.orderPk))
      .where(conditions.length ? and(...conditions) : undefined)

    return apiResponse({
      rows,
      pagination: {
        limit,
        offset,
        total: Number(count ?? 0),
      },
    })
  } catch (err) {
    return apiError(
      'MARKETING_CONSOLIDATED_ERROR',
      err instanceof Error ? err.message : 'Unknown error',
      500
    )
  }
}
