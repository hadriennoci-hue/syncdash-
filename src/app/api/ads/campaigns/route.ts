import { NextRequest } from 'next/server'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { adsAccounts, adsCampaigns, adsCreatives, productImages, products } from '@/lib/db/schema'

const destinationTypeSchema = z.enum(['shopify_komputerzz_product', 'tiktok_shop_product'])

const createSchema = z.object({
  providerId: z.enum(['google_ads', 'meta_ads', 'tiktok_ads']),
  accountPk: z.number().int().positive(),
  name: z.string().min(1).max(255),
  objective: z.string().min(1).max(120),
  destinationType: destinationTypeSchema,
  productSku: z.string().min(1),
  destinationUrl: z.string().url().optional(),
  status: z.enum(['draft', 'approved', 'scheduled', 'live', 'paused', 'completed', 'canceled']).default('draft'),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  budgetMode: z.enum(['daily', 'lifetime']).default('daily'),
  budgetAmountCents: z.number().int().positive().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  targeting: z.record(z.any()).optional(),
  tracking: z.record(z.any()).optional(),
  notes: z.string().max(2000).optional(),
  createdBy: z.enum(['agent', 'human', 'system']).default('agent'),
})

// GET /api/ads/campaigns
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const providerId = req.nextUrl.searchParams.get('providerId')
  const status = req.nextUrl.searchParams.get('status')

  const where = and(
    providerId ? eq(adsAccounts.providerId, providerId) : undefined,
    status ? eq(adsCampaigns.status, status) : undefined
  )

  const rows = await db.select({
    campaignPk: adsCampaigns.campaignPk,
    accountPk: adsCampaigns.accountPk,
    providerId: adsAccounts.providerId,
    accountName: adsAccounts.accountName,
    name: adsCampaigns.name,
    objective: adsCampaigns.objective,
    status: adsCampaigns.status,
    providerCampaignId: adsCampaigns.providerCampaignId,
    startAt: adsCampaigns.startAt,
    endAt: adsCampaigns.endAt,
    budgetMode: adsCampaigns.budgetMode,
    budgetAmountCents: adsCampaigns.budgetAmountCents,
    currencyCode: adsCampaigns.currencyCode,
    destinationType: adsCampaigns.destinationType,
    productSku: adsCampaigns.productSku,
    destinationUrl: adsCampaigns.destinationUrl,
    destinationPending: adsCampaigns.destinationPending,
    targetingJson: adsCampaigns.targetingJson,
    trackingJson: adsCampaigns.trackingJson,
    notes: adsCampaigns.notes,
    createdAt: adsCampaigns.createdAt,
    updatedAt: adsCampaigns.updatedAt,
  })
    .from(adsCampaigns)
    .innerJoin(adsAccounts, eq(adsAccounts.accountPk, adsCampaigns.accountPk))
    .where(where)
    .orderBy(desc(adsCampaigns.createdAt), asc(adsCampaigns.campaignPk))

  const skus = Array.from(new Set(rows.map((r) => r.productSku).filter((s): s is string => Boolean(s))))
  const campaignIds = rows.map((r) => r.campaignPk)
  const imageMap = new Map<string, string>()
  const creativeMap = new Map<number, { primaryText: string | null; headline: string | null; description: string | null; cta: string | null }>()
  if (skus.length > 0) {
    const images = await db.query.productImages.findMany({
      where: inArray(productImages.productId, skus),
      columns: {
        productId: true,
        url: true,
        position: true,
      },
      orderBy: [asc(productImages.productId), asc(productImages.position)],
    })
    for (const img of images) {
      if (!imageMap.has(img.productId)) {
        imageMap.set(img.productId, img.url)
      }
    }
  }

  if (campaignIds.length > 0) {
    const creatives = await db.query.adsCreatives.findMany({
      where: inArray(adsCreatives.campaignPk, campaignIds),
      columns: {
        campaignPk: true,
        primaryText: true,
        headline: true,
        description: true,
        cta: true,
        createdAt: true,
      },
      orderBy: [asc(adsCreatives.campaignPk), asc(adsCreatives.createdAt), asc(adsCreatives.creativePk)],
    })
    for (const c of creatives) {
      if (!creativeMap.has(c.campaignPk)) {
        creativeMap.set(c.campaignPk, {
          primaryText: c.primaryText ?? null,
          headline: c.headline ?? null,
          description: c.description ?? null,
          cta: c.cta ?? null,
        })
      }
    }
  }

  const withImages = rows.map((r) => ({
    ...r,
    productImageUrl: r.productSku ? (imageMap.get(r.productSku) ?? null) : null,
    creativePrimaryText: creativeMap.get(r.campaignPk)?.primaryText ?? null,
    creativeHeadline: creativeMap.get(r.campaignPk)?.headline ?? null,
    creativeDescription: creativeMap.get(r.campaignPk)?.description ?? null,
    creativeCta: creativeMap.get(r.campaignPk)?.cta ?? null,
  }))

  return apiResponse(withImages)
}

// POST /api/ads/campaigns
// Creates a campaign draft/approved record. Destination must target product flow:
// - shopify_komputerzz_product
// - tiktok_shop_product
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const data = parsed.data
  const account = await db.query.adsAccounts.findFirst({
    where: eq(adsAccounts.accountPk, data.accountPk),
    columns: { accountPk: true, providerId: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `ads account ${data.accountPk} not found`, 404)
  }
  if (account.providerId !== data.providerId) {
    return apiError('VALIDATION_ERROR', `account ${data.accountPk} belongs to ${account.providerId}, not ${data.providerId}`, 400)
  }

  const product = await db.query.products.findFirst({
    where: eq(products.id, data.productSku),
    columns: { id: true },
  })
  if (!product) {
    return apiError('NOT_FOUND', `product SKU ${data.productSku} not found`, 404)
  }

  const destinationPending = data.destinationUrl ? 0 : 1
  if (data.status === 'scheduled' && destinationPending === 1) {
    return apiError('VALIDATION_ERROR', 'Cannot create scheduled campaign without destinationUrl', 400)
  }

  const now = new Date().toISOString()
  const inserted = await db.insert(adsCampaigns).values({
    accountPk: data.accountPk,
    name: data.name,
    objective: data.objective,
    status: data.status,
    startAt: data.startAt ?? null,
    endAt: data.endAt ?? null,
    budgetMode: data.budgetMode,
    budgetAmountCents: data.budgetAmountCents ?? null,
    currencyCode: data.currencyCode ?? null,
    targetingJson: data.targeting ? JSON.stringify(data.targeting) : null,
    trackingJson: data.tracking ? JSON.stringify(data.tracking) : null,
    destinationType: data.destinationType,
    productSku: data.productSku,
    destinationUrl: data.destinationUrl ?? null,
    destinationPending,
    notes: data.notes ?? null,
    createdBy: data.createdBy,
    createdAt: now,
    updatedAt: now,
  }).returning({
    campaignPk: adsCampaigns.campaignPk,
  })

  return apiResponse({ campaignPk: inserted[0]?.campaignPk ?? null }, 201)
}
