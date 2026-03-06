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

const tagSchema = z.string().trim().min(1).max(40).regex(/^\S+$/, 'Tags must be single words')

const createSchema = z.object({
  sku:          z.string().min(1),
  title:        z.string().min(1),
  description:          z.string().optional(),
  tags:                 z.array(tagSchema).max(10).optional(),
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
  const pendingReview  = searchParams.get('pendingReview') === '1'
  const missingFields  = searchParams.get('missingFields') === '1'
  const hasStock       = searchParams.get('hasStock') === '1'
  const pushedPlatform = searchParams.get('pushedPlatform') ?? ''
  const offset         = (page - 1) * perPage

  // Build WHERE conditions in SQL
  const conditions = []
  if (search) conditions.push(or(like(products.title, `%${search}%`), like(products.id, `%${search}%`)))
  if (status) conditions.push(eq(products.status, status))
  if (pendingReview) conditions.push(eq(products.pendingReview, 1))
  if (pushedPlatform === 'libre_market') conditions.push(eq(products.pushedLibreMarket, '2push'))
  if (pushedPlatform === 'xmr_bazaar')  conditions.push(eq(products.pushedXmrBazaar, '2push'))
  if (pushedPlatform === 'ebay_ie')     conditions.push(eq(products.pushedEbayIe, '2push'))
  // missingFields: any field that fill-missing would want to fill
  if (missingFields) conditions.push(
    or(
      eq(products.title, products.id),
      sql`${products.description} IS NULL OR ${products.description} = ''`,
      sql`NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = ${products.id})`,
      sql`(SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = ${products.id}) < 2`,
      sql`${products.tags} IS NULL OR ${products.tags} = '' OR NOT json_valid(${products.tags}) OR json_array_length(${products.tags}) < 3`
    )
  )
  // hasStock: at least one warehouse (ireland or acer_store) has quantity > 0
  if (hasStock) conditions.push(
    sql`EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = ${products.id} AND ws.warehouse_id IN ('ireland','acer_store') AND ws.quantity > 0)`
  )
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // Total count (for pagination header)
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(products)
    .where(where)

  const allProducts = await db.query.products.findMany({
    where,
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

  const rows = allProducts.map((p) => {
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

    const stockMap = Object.fromEntries(p.warehouseStock.map((ws) => [ws.warehouseId, {
      qty:              ws.quantity,
      importPrice:      ws.importPrice      ?? null,
      importPromoPrice: ws.importPromoPrice ?? null,
      purchasePrice:    ws.purchasePrice    ?? null,
    }]))

    return {
      id:             p.id,
      title:          p.title,
      status:         p.status,
      supplier:       p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
      hasDescription: !!(p.description?.trim()),
      isFeatured:     !!p.isFeatured,
      imageCount,
      hasMinImages:   imageCount >= 2,
      localization:   null, // derived from categories — computed separately
      platforms:      platformData,
      stock: {
        ireland:          stockMap.ireland?.qty              ?? null,
        poland:           stockMap.poland?.qty               ?? null,
        acer_store:       stockMap.acer_store?.qty           ?? null,
        importPrice:      stockMap.ireland?.importPrice      ?? stockMap.acer_store?.importPrice      ?? null,
        importPromoPrice: stockMap.ireland?.importPromoPrice ?? stockMap.acer_store?.importPromoPrice ?? null,
        purchasePrice:    stockMap.acer_store?.purchasePrice    ?? stockMap.ireland?.purchasePrice ?? null,
      },
      categories:     p.categories.map((c) => c.categoryId),
      collections:    [],
      inconsistencies: 0,
      updatedAt:      p.updatedAt,
    }
  })

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
    ean:          data.ean,
    description:  data.description,
    tags:         data.tags,
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
