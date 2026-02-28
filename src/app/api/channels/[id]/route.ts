import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { products, salesChannels } from '@/lib/db/schema'
import { eq, or, inArray, and, desc, sql } from 'drizzle-orm'
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

  const pushStatusWhere = or(eq(pushCol, '2push'), eq(pushCol, 'done'), sql`${pushCol} LIKE 'FAIL:%'`)
  let rows: Array<{
    id: string
    title: string
    pushedShopifyKomputerzz: string | null
    pushedShopifyTiktok: string | null
    pushedWoocommerce: string | null
    pushedXmrBazaar: string | null
    pushedLibreMarket: string | null
    prices: Array<{ productId: string; platform: string; price: number | null; compareAt: number | null }>
    platformMappings: Array<{ productId: string; platform: string; platformId: string; syncStatus: string }>
    warehouseStock: Array<{ productId: string; warehouseId: string; quantity: number | null; importPrice: number | null; importPromoPrice: number | null }>
  }>

  if (platform === 'shopify_tiktok') {
    // Use direct D1 queries to avoid join/inArray quirks in this endpoint.
    const { env } = getCloudflareContext()
    const binding = (env as Record<string, unknown>).DB as D1Database | undefined
    if (!binding) throw new Error('D1 binding "DB" not found.')

    const idsRes = await binding.prepare(
      `SELECT product_id
       FROM warehouse_stock
       WHERE warehouse_id = 'ireland'
       ORDER BY updated_at DESC`
    ).all()

    const skus = Array.from(new Set((idsRes.results ?? []).map((r) => String((r as any).product_id))))
    if (skus.length === 0) {
      rows = []
    } else {
      const pagedSkus = skus.slice(offset, offset + perPage)
      const placeholders = pagedSkus.map(() => '?').join(',')

      const baseRes = await binding.prepare(
        `SELECT * FROM products WHERE id IN (${placeholders}) ORDER BY updated_at DESC`
      ).bind(...pagedSkus).all()

      const baseProducts = (baseRes.results ?? []).map((row) => ({
        id:                      String((row as any).id),
        title:                   String((row as any).title),
        pushedWoocommerce:       String((row as any).pushed_woocommerce ?? 'N'),
        pushedShopifyKomputerzz: String((row as any).pushed_shopify_komputerzz ?? 'N'),
        pushedShopifyTiktok:     String((row as any).pushed_shopify_tiktok ?? 'N'),
        pushedXmrBazaar:         String((row as any).pushed_xmr_bazaar ?? 'N'),
        pushedLibreMarket:       String((row as any).pushed_libre_market ?? 'N'),
      }))

      const [pricesRes, mappingsRes, stockRes] = await Promise.all([
        binding.prepare(`SELECT * FROM product_prices WHERE product_id IN (${placeholders})`).bind(...pagedSkus).all(),
        binding.prepare(`SELECT * FROM platform_mappings WHERE product_id IN (${placeholders})`).bind(...pagedSkus).all(),
        binding.prepare(`SELECT * FROM warehouse_stock WHERE product_id IN (${placeholders})`).bind(...pagedSkus).all(),
      ])

      const priceRows = (pricesRes.results ?? []).map((r) => ({
        productId: String((r as any).product_id),
        platform:  String((r as any).platform),
        price:     (r as any).price ?? null,
        compareAt: (r as any).compare_at ?? null,
      }))

      const mappingRows = (mappingsRes.results ?? []).map((r) => ({
        productId:  String((r as any).product_id),
        platform:   String((r as any).platform),
        platformId: String((r as any).platform_id),
        syncStatus: String((r as any).sync_status),
      }))

      const stockRows = (stockRes.results ?? []).map((r) => ({
        productId:       String((r as any).product_id),
        warehouseId:     String((r as any).warehouse_id),
        quantity:        (r as any).quantity ?? null,
        importPrice:     (r as any).import_price ?? null,
        importPromoPrice:(r as any).import_promo_price ?? null,
      }))

      rows = baseProducts.map((p) => ({
        ...p,
        prices:           priceRows.filter((pr) => pr.productId === p.id),
        platformMappings: mappingRows.filter((m) => m.productId === p.id),
        warehouseStock:   stockRows.filter((s) => s.productId === p.id),
      }))
    }
  } else {
    rows = await db.query.products.findMany({
      where: pushStatusWhere,
      with:    { prices: true, warehouseStock: true, platformMappings: true },
      orderBy: [
        sql`CASE WHEN ${pushCol} = '2push' THEN 0 WHEN ${pushCol} LIKE 'FAIL:%' THEN 1 ELSE 2 END`,
        desc(products.updatedAt),
      ],
      limit:  perPage,
      offset,
    })
  }

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
      importPrice:      stockMap.ireland.importPrice ?? stockMap.acer_store.importPrice ?? null,
      importPromoPrice: stockMap.ireland.importPromoPrice ?? stockMap.acer_store.importPromoPrice ?? null,
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
