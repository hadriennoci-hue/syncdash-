import { NextRequest } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { adsCampaigns, adsCreatives, adsAccounts, products, socialMediaPosts } from '@/lib/db/schema'

const destinationTypeSchema = z.enum(['shopify_komputerzz_product', 'tiktok_shop_product', 'x_promoted_tweet'])

const nullableIsoDatetime = z.union([z.string().datetime(), z.literal(''), z.null()]).transform((value) => {
  if (value === '' || value == null) return null
  return value
})

const nullableJsonObject = z.union([z.record(z.any()), z.null()])

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  objective: z.string().min(1).max(120).optional(),
  startAt: nullableIsoDatetime.optional(),
  endAt: nullableIsoDatetime.optional(),
  budgetMode: z.enum(['daily', 'lifetime']).optional(),
  budgetAmountCents: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  currencyCode: z.union([z.string().min(3).max(3), z.null()]).optional(),
  destinationType: z.union([destinationTypeSchema, z.null()]).optional(),
  productSku: z.union([z.string().min(1), z.null()]).optional(),
  destinationUrl: z.union([z.string().url(), z.literal(''), z.null()]).transform((value) => {
    if (value === '' || value == null) return null
    return value
  }).optional(),
  promotedTweetId: z.union([z.string().regex(/^\d+$/), z.literal(''), z.null()]).transform((value) => {
    if (value === '' || value == null) return null
    return value
  }).optional(),
  socialPostPk: z.union([z.number().int().positive(), z.null()]).optional(),
  targeting: nullableJsonObject.optional(),
  tracking: nullableJsonObject.optional(),
  notes: z.union([z.string().max(2000), z.null()]).optional(),
  creativePrimaryText: z.union([z.string(), z.null()]).optional(),
  creativeHeadline: z.union([z.string(), z.null()]).optional(),
  creativeDescription: z.union([z.string(), z.null()]).optional(),
  creativeCta: z.union([z.string(), z.null()]).optional(),
})

function hasAnyField(data: z.infer<typeof patchSchema>): boolean {
  return Object.keys(data).length > 0
}

// PATCH /api/ads/campaigns/:id
// Edit non-breaking campaign planning fields.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const campaignPk = Number(params.id)
  if (!Number.isFinite(campaignPk) || campaignPk <= 0) {
    return apiError('VALIDATION_ERROR', 'Invalid campaign id', 400)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }
  if (!hasAnyField(parsed.data)) {
    return apiError('VALIDATION_ERROR', 'No editable field provided', 400)
  }

  const existing = await db.query.adsCampaigns.findFirst({
    where: eq(adsCampaigns.campaignPk, campaignPk),
    columns: {
      campaignPk: true,
      accountPk: true,
      destinationType: true,
      productSku: true,
      destinationUrl: true,
      promotedTweetId: true,
      socialPostPk: true,
    },
  })
  if (!existing) {
    return apiError('NOT_FOUND', `campaign ${campaignPk} not found`, 404)
  }

  const account = await db.query.adsAccounts.findFirst({
    where: eq(adsAccounts.accountPk, existing.accountPk),
    columns: { providerId: true },
  })
  if (!account) {
    return apiError('NOT_FOUND', `ads account ${existing.accountPk} not found`, 404)
  }

  const nextProductSku = parsed.data.productSku === undefined ? existing.productSku : parsed.data.productSku
  if (nextProductSku) {
    const product = await db.query.products.findFirst({
      where: eq(products.id, nextProductSku),
      columns: { id: true },
    })
    if (!product) {
      return apiError('NOT_FOUND', `product SKU ${nextProductSku} not found`, 404)
    }
  }

  const nextSocialPostPk = parsed.data.socialPostPk === undefined ? existing.socialPostPk : parsed.data.socialPostPk
  if (nextSocialPostPk) {
    const post = await db.query.socialMediaPosts.findFirst({
      where: eq(socialMediaPosts.postPk, nextSocialPostPk),
      columns: { postPk: true },
    })
    if (!post) {
      return apiError('NOT_FOUND', `social post ${nextSocialPostPk} not found`, 404)
    }
  }

  const nextDestinationUrl = parsed.data.destinationUrl === undefined ? existing.destinationUrl : parsed.data.destinationUrl
  const nextDestinationType = parsed.data.destinationType === undefined ? existing.destinationType : parsed.data.destinationType
  const nextPromotedTweetId = parsed.data.promotedTweetId === undefined ? existing.promotedTweetId : parsed.data.promotedTweetId
  const hasXTweetRef = !!(nextPromotedTweetId || nextSocialPostPk)

  if (account.providerId === 'x_ads' && !hasXTweetRef) {
    return apiError('VALIDATION_ERROR', 'x_ads campaigns require promotedTweetId or socialPostPk', 400)
  }
  if (account.providerId === 'x_ads' && nextDestinationType !== 'x_promoted_tweet') {
    return apiError('VALIDATION_ERROR', 'x_ads campaigns must use destinationType=x_promoted_tweet', 400)
  }
  if (account.providerId !== 'x_ads' && nextDestinationType === 'x_promoted_tweet') {
    return apiError('VALIDATION_ERROR', 'x_promoted_tweet is only valid for x_ads campaigns', 400)
  }

  const destinationPending = account.providerId === 'x_ads'
    ? (hasXTweetRef ? 0 : 1)
    : (nextDestinationUrl ? 0 : 1)
  const now = new Date().toISOString()

  await db.update(adsCampaigns).set({
    name: parsed.data.name,
    objective: parsed.data.objective,
    startAt: parsed.data.startAt,
    endAt: parsed.data.endAt,
    budgetMode: parsed.data.budgetMode,
    budgetAmountCents: parsed.data.budgetAmountCents,
    currencyCode: parsed.data.currencyCode?.toUpperCase(),
    destinationType: parsed.data.destinationType,
    productSku: parsed.data.productSku,
    destinationUrl: parsed.data.destinationUrl,
    promotedTweetId: parsed.data.promotedTweetId,
    socialPostPk: parsed.data.socialPostPk,
    destinationPending,
    targetingJson: parsed.data.targeting === undefined ? undefined : (parsed.data.targeting ? JSON.stringify(parsed.data.targeting) : null),
    trackingJson: parsed.data.tracking === undefined ? undefined : (parsed.data.tracking ? JSON.stringify(parsed.data.tracking) : null),
    notes: parsed.data.notes,
    updatedAt: now,
  }).where(eq(adsCampaigns.campaignPk, campaignPk))

  const hasCreativePatch = (
    parsed.data.creativePrimaryText !== undefined ||
    parsed.data.creativeHeadline !== undefined ||
    parsed.data.creativeDescription !== undefined ||
    parsed.data.creativeCta !== undefined ||
    parsed.data.destinationUrl !== undefined
  )

  if (hasCreativePatch) {
    const firstCreative = await db.query.adsCreatives.findFirst({
      where: eq(adsCreatives.campaignPk, campaignPk),
      columns: { creativePk: true },
      orderBy: [asc(adsCreatives.createdAt), asc(adsCreatives.creativePk)],
    })

    if (firstCreative) {
      await db.update(adsCreatives).set({
        primaryText: parsed.data.creativePrimaryText,
        headline: parsed.data.creativeHeadline,
        description: parsed.data.creativeDescription,
        cta: parsed.data.creativeCta,
        destinationUrl: parsed.data.destinationUrl,
        updatedAt: now,
      }).where(eq(adsCreatives.creativePk, firstCreative.creativePk))
    } else {
      await db.insert(adsCreatives).values({
        campaignPk,
        primaryText: parsed.data.creativePrimaryText ?? null,
        headline: parsed.data.creativeHeadline ?? null,
        description: parsed.data.creativeDescription ?? null,
        cta: parsed.data.creativeCta ?? null,
        destinationUrl: parsed.data.destinationUrl ?? null,
        mediaType: 'image',
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return apiResponse({ ok: true, destinationPending })
}
