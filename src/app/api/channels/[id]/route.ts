import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings, productPrices } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { PLATFORMS, PLATFORM_LABELS } from '@/types/platform'
import type { Platform } from '@/types/platform'

export const runtime = 'edge'

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
    id:          platform,
    label:       PLATFORM_LABELS[platform],
    productCount: mappings.length,
    syncStatus:  { synced, stale, errored },
    products:    mappings.map((m) => ({
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
