import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateProduct, deleteProduct } from '@/lib/functions/products'
import type { Platform } from '@/types/platform'

const tagSchema = z.string().trim().min(1).max(40).regex(/^\S+$/, 'Tags must be single words')

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !/\s/.test(value))
      .slice(0, 10)
  } catch {
    return []
  }
}

function shopifyAdminUrl(shopEnvVar: string | undefined, platformId: string): string | null {
  if (!shopEnvVar) return null
  const numId = platformId.replace(/^.*\/(\d+)$/, '$1')
  return `https://${shopEnvVar}/admin/products/${numId}`
}

function buildListingUrl(platform: string, platformId: string | null): string | null {
  if (!platformId) return null
  switch (platform) {
    case 'woocommerce': {
      const base = process.env.COINCART_URL
      return base ? `${base}/?p=${platformId}` : null
    }
    case 'shopify_komputerzz':
      return shopifyAdminUrl(process.env.SHOPIFY_KOMPUTERZZ_SHOP, platformId)
    case 'shopify_tiktok':
      return shopifyAdminUrl(process.env.SHOPIFY_TIKTOK_SHOP, platformId)
    case 'ebay_ie':
      return 'https://www.ebay.ie/sh/lst/active'
    case 'libre_market':
      return `https://libre-market.com/m/coincart/admin/products/${platformId}`
    case 'xmr_bazaar':
      return `https://xmrbazaar.com/listing/${platformId}/`
    default:
      return null
  }
}

const patchSchema = z.object({
  fields: z.object({
    title:                z.string().optional(),
    description:          z.string().optional(),
    tags:                 z.array(tagSchema).max(10).optional(),
    status:               z.enum(['active', 'archived']).optional(),
    isFeatured:           z.boolean().optional(),
    categoryIds:          z.array(z.string()).optional(),
    ean:                  z.string().length(13).optional(),
    commodityCode:        z.string().optional(),
    customsDescription:   z.string().optional(),
    countryOfManufacture: z.string().optional(),
    weight:               z.number().positive().optional(),
    weightUnit:           z.enum(['kg', 'g', 'lb', 'oz']).optional(),
  }),
  platforms:   z.array(z.string()).min(1).optional(),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

const deleteSchema = z.object({
  platforms:   z.array(z.string()).min(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function GET(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const product = await db.query.products.findFirst({
    where: eq(products.id, params.sku),
    with: {
      supplier:         true,
      variants:         true,
      images:           true,
      prices:           true,
      metafields:       true,
      platformMappings: true,
      categories:       { with: { category: true } },
      warehouseStock:   true,
    },
  })

  if (!product) return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)

  const localization: string | null = null

  const priceMap = Object.fromEntries(
    product.prices.map((p) => [p.platform, { price: p.price, compareAt: p.compareAt }])
  )
  const mappingMap = Object.fromEntries(
    product.platformMappings.map((m) => [m.platform, {
      platformId: m.platformId,
      recordType: m.recordType,
      syncStatus: m.syncStatus,
      listingUrl: buildListingUrl(m.platform, m.platformId),
    }])
  )
  const stockMap = Object.fromEntries(
    product.warehouseStock.map((ws) => [ws.warehouseId, {
      quantity:        ws.quantity,
      quantityOrdered: ws.quantityOrdered ?? 0,
      purchasePrice:   ws.purchasePrice,
    }])
  )

  return apiResponse({
    id:                   product.id,
    title:                product.title,
    description:          product.description,
    tags:                 parseTags(product.tags),
    status:               product.status,
    taxCode:              product.taxCode,
    ean:                  product.ean,
    commodityCode:        product.commodityCode,
    customsDescription:   product.customsDescription,
    countryOfManufacture: product.countryOfManufacture,
    weight:               product.weight,
    weightUnit:           product.weightUnit,
    vendor:               product.vendor,
    productType:          product.productType,
    isFeatured:           !!product.isFeatured,
    supplier:             product.supplier,
    variants:             product.variants,
    images:               product.images,
    metafields:           product.metafields,
    prices:               priceMap,
    platforms:            mappingMap,
    stock:                stockMap,
    localization,
    categories: product.categories
      .filter((c) => c.category)
      .map((c) => ({ id: c.categoryId, name: c.category!.name, slug: c.category!.slug, type: c.category!.collectionType, platform: c.category!.platform })),
    pushStatus: {
      woocommerce:        product.pushedWoocommerce,
      shopify_komputerzz: product.pushedShopifyKomputerzz,
      shopify_tiktok:     product.pushedShopifyTiktok,
      ebay_ie:            product.pushedEbayIe,
      xmr_bazaar:         product.pushedXmrBazaar,
      libre_market:       product.pushedLibreMarket,
    },
    createdAt:            product.createdAt,
    updatedAt:            product.updatedAt,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await updateProduct(params.sku, {
    fields:      parsed.data.fields,
    platforms:   (parsed.data.platforms ?? []) as Platform[],
    triggeredBy: parsed.data.triggeredBy,
  })

  return apiResponse(results)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await deleteProduct(
    params.sku,
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )

  return apiResponse(results)
}
