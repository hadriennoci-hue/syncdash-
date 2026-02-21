import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateProduct, deleteProduct } from '@/lib/functions/products'
import type { Platform } from '@/types/platform'
import { COUNTRY_LAYOUT_MAP } from '@/types/product'

export const runtime = 'edge'

const patchSchema = z.object({
  fields: z.object({
    title:                z.string().optional(),
    description:          z.string().optional(),
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
  platforms:   z.array(z.string()).min(1),
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
      categories:       { with: { } },
      warehouseStock:   true,
    },
  })

  if (!product) return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)

  // Compute localization from categories
  const cats = await db.query.productCategories.findMany({
    where: eq(require('@/lib/db/schema').productCategories.productId, params.sku),
  })
  let localization: string | null = null
  // Would need a join with categories table for collection_type — simplified here

  const priceMap = Object.fromEntries(
    product.prices.map((p) => [p.platform, { price: p.price, compareAt: p.compareAt }])
  )
  const mappingMap = Object.fromEntries(
    product.platformMappings.map((m) => [m.platform, {
      platformId: m.platformId,
      recordType: m.recordType,
      syncStatus: m.syncStatus,
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
    platforms:   parsed.data.platforms as Platform[],
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
