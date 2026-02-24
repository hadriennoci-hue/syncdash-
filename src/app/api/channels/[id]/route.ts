import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, salesChannels } from '@/lib/db/schema'
import { eq, ne, desc, sql } from 'drizzle-orm'
import type { Platform } from '@/types/platform'

const WAREHOUSES = ['ireland', 'acer_store', 'poland'] as const

function getPushCol(platform: Platform) {
  if (platform === 'shopify_komputerzz') return products.pushedShopifyKomputerzz
  if (platform === 'shopify_tiktok')     return products.pushedShopifyTiktok
  if (platform === 'xmr_bazaar')         return products.pushedXmrBazaar
  if (platform === 'libre_market')       return products.pushedLibreMarket
  return products.pushedWoocommerce
}

function getPushValue(p: Record<string, unknown>, platform: Platform): string {
  if (platform === 'shopify_komputerzz') return String(p.pushedShopifyKomputerzz ?? 'N')
  if (platform === 'shopify_tiktok')     return String(p.pushedShopifyTiktok ?? 'N')
  if (platform === 'xmr_bazaar')         return String(p.pushedXmrBazaar ?? 'N')
  if (platform === 'libre_market')       return String(p.pushedLibreMarket ?? 'N')
  return String(p.pushedWoocommerce ?? 'N')
}

// Platforms that have push columns in the products table (includes browser channels)
const PUSH_PLATFORMS: Platform[] = [
  'woocommerce', 'shopify_komputerzz', 'shopify_tiktok',
  'xmr_bazaar', 'libre_market',
]

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const platform = params.id as Platform

  // Validate against sales_channels table (source of truth for all channels)
  const channel = await db.query.salesChannels.findFirst({
    where: eq(salesChannels.id, platform),
  })
  if (!channel) return apiError('NOT_FOUND', `Unknown channel: ${params.id}`, 404)

  const channelMeta = {
    id:            channel.id,
    name:          channel.name,
    url:           channel.url,
    connectorType: channel.connectorType,
    enabled:       channel.enabled,
    config:        channel.config ? JSON.parse(channel.config) : null,
    lastPush:      channel.lastPush,
  }

  // Browser channels have no push columns yet — return metadata only
  if (!PUSH_PLATFORMS.includes(platform)) {
    return apiResponse({
      ...channelMeta,
      counts:   { synced: 0, pending: 0, failed: 0, total: 0 },
      products: [],
    })
  }

  const { searchParams } = new URL(req.url)
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const offset  = (page - 1) * perPage

  const pushCol = getPushCol(platform)

  const rows = await db.query.products.findMany({
    where:   ne(pushCol, 'N'),
    with:    { prices: true, warehouseStock: true, platformMappings: true },
    orderBy: [
      sql`CASE WHEN ${pushCol} = '2push' THEN 0 ELSE 1 END`,
      desc(products.updatedAt),
    ],
    limit:  perPage,
    offset,
  })

  let synced = 0, pending = 0, failed = 0
  for (const row of rows) {
    const v = getPushValue(row as Record<string, unknown>, platform)
    if (v === 'done')              synced++
    else if (v === '2push')        pending++
    else if (v.startsWith('FAIL:')) failed++
  }

  const data = rows.map((p) => {
    const pushStatus = getPushValue(p as Record<string, unknown>, platform)
    const priceRow   = p.prices.find((pr) => pr.platform === platform)
    const mapping    = p.platformMappings.find((m) => m.platform === platform)

    const stockMap = Object.fromEntries(
      WAREHOUSES.map((wId) => {
        const ws = p.warehouseStock.find((s) => s.warehouseId === wId)
        return [wId, { qty: ws?.quantity ?? null, importPrice: ws?.importPrice ?? null, importPromoPrice: ws?.importPromoPrice ?? null }]
      })
    )

    return {
      sku:              p.id,
      title:            p.title,
      pushStatus,
      price:            priceRow?.price    ?? null,
      compareAt:        priceRow?.compareAt ?? null,
      importPrice:      stockMap.acer_store.importPrice,
      importPromoPrice: stockMap.acer_store.importPromoPrice,
      stock: {
        ireland:    stockMap.ireland.qty,
        acer_store: stockMap.acer_store.qty,
        poland:     stockMap.poland.qty,
      },
      platformId:  mapping?.platformId ?? null,
      syncStatus:  mapping?.syncStatus ?? null,
    }
  })

  return apiResponse({
    ...channelMeta,
    counts:   { synced, pending, failed, total: rows.length },
    products: data,
  })
}
