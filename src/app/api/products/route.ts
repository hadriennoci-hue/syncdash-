import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError, paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productPrices, productImages, platformMappings, warehouseStock, productCategories } from '@/lib/db/schema'
import { eq, like, or, and, sql } from 'drizzle-orm'
import { createProduct } from '@/lib/functions/products'
import { PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'

export const runtime = 'edge'

const createSchema = z.object({
  sku:          z.string().min(1),
  title:        z.string().min(1),
  description:          z.string().optional(),
  vendor:               z.string().optional(),
  productType:          z.string().optional(),
  taxCode:              z.string().optional(),
  ean:                  z.string().length(13).optional(),
  commodityCode:        z.string().optional(),
  customsDescription:   z.string().optional(),
  countryOfManufacture: z.string().optional(),
  weight:               z.number().positive().optional(),
  weightUnit:           z.enum(['kg', 'g', 'lb', 'oz']).optional(),
  isFeatured:           z.boolean().optional(),
  supplierId:           z.string().optional(),
  variants:     z.array(z.object({
    title:     z.string().optional(),
    sku:       z.string().optional(),
    price:     z.number().optional(),
    compareAt: z.number().optional(),
    stock:     z.number().optional(),
    option1:   z.string().optional(),
    option2:   z.string().optional(),
    option3:   z.string().optional(),
  })).optional(),
  images:        z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: z.string().url(), alt: z.string().optional() }),
    z.object({ type: z.literal('file'), data: z.any(), filename: z.string(), mimeType: z.string() }),
  ])).optional(),
  prices:        z.record(z.number()).optional(),
  compareAtPrices: z.record(z.number()).optional(),
  categoryIds:   z.array(z.string()).optional(),
  platforms:     z.array(z.string()).min(1),
  triggeredBy:   z.enum(['human', 'agent']).default('human'),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const search        = searchParams.get('search') ?? ''
  const status        = searchParams.get('status') ?? ''
  const pendingReview = searchParams.get('pendingReview') === '1'
  const offset        = (page - 1) * perPage

  const allProducts = await db.query.products.findMany({
    with: {
      supplier:         true,
      images:           true,
      prices:           true,
      platformMappings: true,
      categories:       true,
      warehouseStock:   true,
    },
    limit:  perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  })

  // Filter in JS (D1 has limited SQL capabilities)
  const filtered = allProducts.filter((p) => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.id.toLowerCase().includes(search.toLowerCase())) return false
    if (status && p.status !== status) return false
    if (pendingReview && !p.pendingReview) return false
    return true
  })

  const rows = filtered.map((p) => {
    const imageCount = p.images.length
    const priceMap = Object.fromEntries(p.prices.map((pr) => [pr.platform, { price: pr.price, compareAt: pr.compareAt }]))
    const mappingMap = Object.fromEntries(p.platformMappings.map((m) => [m.platform, m]))

    const platformData = Object.fromEntries(
      PLATFORMS.map((pl) => [pl, {
        status:     mappingMap[pl] ? (mappingMap[pl].syncStatus === 'synced' ? 'synced' : 'differences') : 'missing',
        price:      priceMap[pl]?.price ?? null,
        compareAt:  priceMap[pl]?.compareAt ?? null,
      }])
    )

    const stockMap = Object.fromEntries(p.warehouseStock.map((ws) => [ws.warehouseId, ws.quantity]))

    return {
      id:             p.id,
      title:          p.title,
      status:         p.status,
      supplier:       p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
      hasDescription: !!(p.description?.trim()),
      isFeatured:     !!p.isFeatured,
      imageCount,
      hasMinImages:   imageCount >= 5,
      localization:   null, // derived from categories — computed separately
      platforms:      platformData,
      stock:          { ireland: stockMap.ireland ?? null, poland: stockMap.poland ?? null, acer_store: stockMap.acer_store ?? null },
      categories:     p.categories.map((c) => c.categoryId),
      collections:    [],
      inconsistencies: 0,
      updatedAt:      p.updatedAt,
    }
  })

  const total = rows.length
  return paginatedResponse(rows, total, page, perPage)
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const data = parsed.data
  const results = await createProduct({
    sku:          data.sku,
    title:        data.title,
    description:  data.description,
    vendor:       data.vendor,
    productType:  data.productType,
    taxCode:      data.taxCode,
    isFeatured:   data.isFeatured,
    supplierId:   data.supplierId,
    variants:     data.variants,
    images:       data.images as never,
    prices:       data.prices as Partial<Record<Platform, number>>,
    compareAtPrices: data.compareAtPrices as Partial<Record<Platform, number>>,
    categoryIds:  data.categoryIds,
    platforms:    data.platforms as Platform[],
    triggeredBy:  data.triggeredBy,
  })

  return apiResponse({ sku: data.sku, results }, 201)
}
