import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError, paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productPrices, productImages, platformMappings, warehouseStock, productCategories } from '@/lib/db/schema'
import { eq, like, or, and, sql } from 'drizzle-orm'
import { getCloudflareContext } from '@opennextjs/cloudflare'
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
    optionName1: z.string().optional(),
    option1:   z.string().optional(),
    optionName2: z.string().optional(),
    option2:   z.string().optional(),
    optionName3: z.string().optional(),
    option3:   z.string().optional(),
  })).optional(),
  images:        z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: z.string().url(), alt: z.string().optional() }),
    z.object({ type: z.literal('file'), data: z.any(), filename: z.string(), mimeType: z.string() }),
  ])).optional(),
  prices:        z.record(z.number()).optional(),
  compareAtPrices: z.record(z.number()).optional(),
  categoryIds:   z.array(z.string()).optional(),
  collections:   z.array(z.string()).optional(),
  platforms:     z.array(z.string()).min(1),
  triggeredBy:   z.enum(['human', 'agent']).default('human'),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 1000)
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
    and(
      sql`${products.status} <> 'active'`,
      or(
        eq(products.title, products.id),
        sql`${products.description} IS NULL OR ${products.description} = ''`,
        sql`NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = ${products.id})`,
        sql`(SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = ${products.id}) < 1`,
        sql`${products.tags} IS NULL OR ${products.tags} = '' OR NOT json_valid(${products.tags}) OR json_array_length(${products.tags}) < 3`
      )
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

  // Step 1: fetch base product rows + supplier (1:1, safe from D1 row limits)
  const baseProducts = await db.query.products.findMany({
    where,
    with: { supplier: true },
    limit:  perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  })

  const skus = baseProducts.map((p) => p.id)

  let rows: ReturnType<typeof buildRow>[] = []

  if (skus.length > 0) {
    // Step 2: chunked raw D1 queries for heavy relations (product_prices and
    // platform_mappings have up to 6 rows per product — easily exceeds D1's
    // 1000-row result cap when fetched via Drizzle JOIN for large page sizes).
    const { env } = getCloudflareContext()
    const binding = (env as Record<string, unknown>).DB as D1Database | undefined
    if (!binding) throw new Error('D1 binding "DB" not found.')

    const CHUNK = 99
    async function fetchChunked(table: string) {
      const out: Record<string, unknown>[] = []
      for (let i = 0; i < skus.length; i += CHUNK) {
        const chunk = skus.slice(i, i + CHUNK)
        const ph = chunk.map(() => '?').join(',')
        const res = await binding!.prepare(`SELECT * FROM ${table} WHERE product_id IN (${ph})`).bind(...chunk).all()
        out.push(...((res.results ?? []) as Record<string, unknown>[]))
      }
      return out
    }

    const [metafieldRaw, priceRaw, mappingsRaw, stockRaw, imagesRaw, categoriesRaw] = await Promise.all([
      fetchChunked('product_metafields'),
      fetchChunked('product_prices'),
      fetchChunked('platform_mappings'),
      fetchChunked('warehouse_stock'),
      fetchChunked('product_images'),
      fetchChunked('product_categories'),
    ])

    rows = baseProducts.map((p) => buildRow(p, metafieldRaw, priceRaw, mappingsRaw, stockRaw, imagesRaw, categoriesRaw))
  }

  function buildRow(
    p: typeof baseProducts[number],
    metafieldRaw: Record<string, unknown>[],
    priceRaw: Record<string, unknown>[],
    mappingsRaw: Record<string, unknown>[],
    stockRaw: Record<string, unknown>[],
    imagesRaw: Record<string, unknown>[],
    categoriesRaw: Record<string, unknown>[],
  ) {
    const myMetafields = metafieldRaw.filter((r) => r.product_id === p.id && r.namespace === 'competitor')
    const myPrices    = priceRaw.filter((r) => r.product_id === p.id)
    const myMappings  = mappingsRaw.filter((r) => r.product_id === p.id)
    const myStock     = stockRaw.filter((r) => r.product_id === p.id)
    const imageCount  = imagesRaw.filter((r) => r.product_id === p.id).length
    const myCategories = categoriesRaw.filter((r) => r.product_id === p.id)

    const priceMap   = Object.fromEntries(myPrices.map((r) => [String(r.platform), { price: r.price as number | null, compareAt: r.compare_at as number | null }]))
    const mappingMap = Object.fromEntries(myMappings.map((r) => [String(r.platform), r]))
    const competitorMap = Object.fromEntries(myMetafields.map((r) => [String(r.key), r.value]))

    const platformData = Object.fromEntries(
      PLATFORMS.map((pl) => [pl, {
        status:    mappingMap[pl] ? (mappingMap[pl].sync_status === 'synced' ? 'synced' : 'differences') : 'missing',
        price:     priceMap[pl]?.price     ?? null,
        compareAt: priceMap[pl]?.compareAt ?? null,
      }])
    )

    const stockMap = Object.fromEntries(myStock.map((r) => [String(r.warehouse_id), {
      qty:              (r.quantity as number | null) ?? null,
      importPrice:      (r.import_price as number | null) ?? null,
      importPromoPrice: (r.import_promo_price as number | null) ?? null,
      purchasePrice:    (r.purchase_price as number | null) ?? null,
    }]))

    return {
      id:             p.id,
      title:          p.title,
      status:         p.status,
      competitor: {
        price:     competitorMap.price ? Number(competitorMap.price) : null,
        url:       typeof competitorMap.url === 'string' ? competitorMap.url : null,
        priceType: competitorMap.price_type === 'promo' || competitorMap.price_type === 'normal'
          ? competitorMap.price_type
          : null,
      },
      supplier:       p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
      hasDescription: !!(p.description?.trim()),
      isFeatured:     !!p.isFeatured,
      imageCount,
      hasMinImages:   imageCount >= 1,
      localization:   null,
      platforms:      platformData,
      stock: {
        ireland:          stockMap.ireland?.qty              ?? null,
        poland:           stockMap.poland?.qty               ?? null,
        acer_store:       stockMap.acer_store?.qty           ?? null,
        importPrice:      stockMap.ireland?.importPrice      ?? stockMap.acer_store?.importPrice      ?? null,
        importPromoPrice: stockMap.ireland?.importPromoPrice ?? stockMap.acer_store?.importPromoPrice ?? null,
        purchasePrice:    stockMap.acer_store?.purchasePrice ?? stockMap.ireland?.purchasePrice       ?? null,
      },
      categories:      [],
      collections:     myCategories.map((c) => String(c.category_id)),
      inconsistencies: 0,
      updatedAt:       p.updatedAt,
    }
  }

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
    categoryIds:  data.categoryIds ?? data.collections,
    platforms:    data.platforms as Platform[],
    triggeredBy:  data.triggeredBy,
  })

  return apiResponse({ sku: data.sku, results }, 201)
}
