import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings, productPrices, warehouseStock, products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'
import type { Platform } from '@/types/platform'

// Warehouse that is the canonical stock source for each channel
const CHANNEL_WAREHOUSE: Partial<Record<Platform, string>> = {
  shopify_tiktok: 'ireland',
}

// GET — channel summary: product count, sync status breakdown, prices
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const platform = params.id as Platform
  if (!PLATFORMS.includes(platform)) {
    return apiError('NOT_FOUND', `Unknown channel: ${params.id}`, 404)
  }

  const { searchParams } = new URL(req.url)
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const offset  = (page - 1) * perPage

  const sourceWarehouse = CHANNEL_WAREHOUSE[platform]

  // For TikTok (and any channel with a canonical warehouse): list all products
  // in that warehouse, enriched with TikTok mapping info when available.
  if (sourceWarehouse) {
    const stockRows = await db.query.warehouseStock.findMany({
      where:   eq(warehouseStock.warehouseId, sourceWarehouse),
      with:    { product: { columns: { id: true, title: true, status: true } } },
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
      limit:   perPage,
      offset,
    })

    const skus = stockRows.map((s) => s.productId)

    const [mappingRows, priceRows] = await Promise.all([
      db.query.platformMappings.findMany({ where: eq(platformMappings.platform, platform) }),
      db.query.productPrices.findMany({ where: eq(productPrices.platform, platform) }),
    ])

    const mappingMap = Object.fromEntries(mappingRows.map((m) => [m.productId, m]))
    const priceMap   = Object.fromEntries(priceRows.map((p) => [p.productId, { price: p.price, compareAt: p.compareAt }]))

    const synced  = mappingRows.filter((m) => m.syncStatus === 'synced').length
    const stale   = mappingRows.filter((m) => m.syncStatus === 'stale').length
    const errored = mappingRows.filter((m) => m.syncStatus === 'error').length

    return apiResponse({
      id:           platform,
      label:        PLATFORM_LABELS[platform],
      sourceWarehouse,
      productCount: stockRows.length,
      syncStatus:   { synced, stale, errored },
      products:     stockRows.map((s) => {
        const mapping = mappingMap[s.productId]
        return {
          sku:           s.productId,
          title:         s.product?.title  ?? null,
          status:        s.product?.status ?? null,
          irelandQty:    s.quantity,
          platformId:    mapping?.platformId  ?? null,
          syncStatus:    mapping?.syncStatus  ?? 'missing',
          price:         priceMap[s.productId]?.price     ?? null,
          compareAt:     priceMap[s.productId]?.compareAt ?? null,
          updatedAt:     s.updatedAt,
        }
      }),
    })
  }

  // Default: list products by platform mapping
  const mappings = await db.query.platformMappings.findMany({
    where:   eq(platformMappings.platform, platform),
    with:    { product: { columns: { id: true, title: true, status: true } } },
    limit:   perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  })

  const prices = await db.query.productPrices.findMany({
    where: eq(productPrices.platform, platform),
  })
  const priceMap = Object.fromEntries(prices.map((p) => [p.productId, { price: p.price, compareAt: p.compareAt }]))

  const synced   = mappings.filter((m) => m.syncStatus === 'synced').length
  const stale    = mappings.filter((m) => m.syncStatus === 'stale').length
  const errored  = mappings.filter((m) => m.syncStatus === 'error').length

  return apiResponse({
    id:           platform,
    label:        PLATFORM_LABELS[platform],
    productCount: mappings.length,
    syncStatus:   { synced, stale, errored },
    products:     mappings.map((m) => ({
      sku:        m.productId,
      title:      m.product?.title    ?? null,
      status:     m.product?.status   ?? null,
      platformId: m.platformId,
      syncStatus: m.syncStatus,
      price:      priceMap[m.productId]?.price     ?? null,
      compareAt:  priceMap[m.productId]?.compareAt ?? null,
      updatedAt:  m.updatedAt,
    })),
  })
}
