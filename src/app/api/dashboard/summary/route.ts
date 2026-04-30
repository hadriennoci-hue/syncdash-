import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { salesChannels, products, adsCampaigns, orders, salesOrders } from '@/lib/db/schema'
import { eq, or, and, like, sql, gte, inArray } from 'drizzle-orm'
import { PLATFORM_LABELS, PLATFORMS, WAREHOUSE_LABELS } from '@/types/platform'

const ACTIVE_WAREHOUSES = ['ireland', 'poland', 'acer_store', 'dropshipping'] as const

function isMissingSchemaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('no such table') || msg.includes('no such column')
}

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const programmedStatuses = ['scheduled', 'approved'] as const

  const [stockRows, mappingRows, channels, productsToFillRows, campaignRows, sales24Rows, lastInvoiceRows] = await Promise.all([
    db.query.warehouseStock.findMany({ columns: { warehouseId: true, quantity: true } }).catch((err) => {
      if (isMissingSchemaError(err)) return []
      throw err
    }),
    db.query.platformMappings.findMany({ columns: { platform: true } }).catch((err) => {
      if (isMissingSchemaError(err)) return []
      throw err
    }),
    db.query.salesChannels.findMany({ where: eq(salesChannels.enabled, 1) }).catch((err) => {
      if (isMissingSchemaError(err)) return []
      throw err
    }),
    db.select({ total: sql<number>`count(*)` })
      .from(products)
      .where(sql`${products.status} <> 'active'`)
      .catch((err) => {
        if (isMissingSchemaError(err)) return [{ total: 0 }]
        throw err
      }),
    db.select({
      destinationType: adsCampaigns.destinationType,
      count: sql<number>`count(*)`,
    })
      .from(adsCampaigns)
      .where(inArray(adsCampaigns.status, programmedStatuses as unknown as string[]))
      .groupBy(adsCampaigns.destinationType)
      .catch((err) => {
        if (isMissingSchemaError(err)) return []
        throw err
      }),
    db.select({
      channelId: salesOrders.channelId,
      revenueCents: sql<number>`coalesce(sum(${salesOrders.netAmountCents}), 0)`,
    })
      .from(salesOrders)
      .where(gte(salesOrders.orderCreatedAt, twentyFourHoursAgo))
      .groupBy(salesOrders.channelId)
      .catch((err) => {
        if (isMissingSchemaError(err)) return []
        throw err
      }),
    db.select({
      lastInvoiceDate: sql<string>`max(${orders.orderDate})`,
    })
      .from(orders)
      .catch((err) => {
        if (isMissingSchemaError(err)) return [{ lastInvoiceDate: null as unknown as string }]
        throw err
      }),
  ])

  const pushWhere = and(
    or(
      eq(products.pushedCoincart2, '2push'),
      eq(products.pushedShopifyKomputerzz, '2push'),
      eq(products.pushedShopifyTiktok, '2push'),
      eq(products.pushedEbayIe, '2push'),
      eq(products.pushedLibreMarket, '2push'),
      eq(products.pushedXmrBazaar, '2push'),
      like(products.pushedCoincart2, 'FAIL:%'),
      like(products.pushedShopifyKomputerzz, 'FAIL:%'),
      like(products.pushedShopifyTiktok, 'FAIL:%'),
      like(products.pushedEbayIe, 'FAIL:%'),
      like(products.pushedLibreMarket, 'FAIL:%'),
      like(products.pushedXmrBazaar, 'FAIL:%')
    ),
    sql`EXISTS (
      SELECT 1
      FROM warehouse_stock ws
      WHERE ws.product_id = ${products.id}
        AND ws.quantity > 0
    )`
  )

  const [readyCountRow, readyRows] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(products).where(pushWhere).catch((err) => {
      if (isMissingSchemaError(err)) return [{ total: 0 }]
      throw err
    }),
    db.query.products.findMany({
      where: pushWhere,
      columns: { id: true },
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
      limit: 200,
    }).catch((err) => {
      if (isMissingSchemaError(err)) return []
      throw err
    }),
  ])

  // Count refs in stock per warehouse (quantity > 0) and total refs per warehouse.
  const stockCounts: Record<string, number> = {}
  const totalWarehouseRefs: Record<string, number> = {}
  for (const row of stockRows) {
    totalWarehouseRefs[row.warehouseId] = (totalWarehouseRefs[row.warehouseId] ?? 0) + 1
    if (row.quantity > 0) {
      stockCounts[row.warehouseId] = (stockCounts[row.warehouseId] ?? 0) + 1
    }
  }

  // Count refs listed per channel
  const listingCounts: Record<string, number> = {}
  for (const row of mappingRows) {
    listingCounts[row.platform] = (listingCounts[row.platform] ?? 0) + 1
  }

  const sales24hByChannel: Record<string, number> = {}
  for (const row of sales24Rows) {
    sales24hByChannel[row.channelId] = row.revenueCents ?? 0
  }

  const googleAdsCampaignsProgrammedByChannel: Record<string, number> = {}
  for (const platformId of PLATFORMS) {
    googleAdsCampaignsProgrammedByChannel[platformId] = 0
  }
  for (const row of campaignRows) {
    if (row.destinationType === 'shopify_komputerzz_product') {
      googleAdsCampaignsProgrammedByChannel.shopify_komputerzz += row.count
    } else if (row.destinationType === 'tiktok_shop_product') {
      googleAdsCampaignsProgrammedByChannel.shopify_tiktok += row.count
    }
  }

  const channelRows = channels.length > 0
    ? channels
    : PLATFORMS.map((platformId) => ({
      id: platformId,
      name: PLATFORM_LABELS[platformId],
      url: '',
      connectorType: platformId === 'libre_market' || platformId === 'xmr_bazaar' ? 'browser' : 'api',
      enabled: 1,
      config: null,
      lastPush: null,
      createdAt: null,
    }))

  const lastPush = channelRows.reduce<string | null>((latest, channel) => {
    if (!channel.lastPush) return latest
    if (!latest) return channel.lastPush
    return channel.lastPush > latest ? channel.lastPush : latest
  }, null)

  return apiResponse({
    warehouses: ACTIVE_WAREHOUSES.map((id) => ({
      id,
      label: WAREHOUSE_LABELS[id],
      refsInStock: stockCounts[id] ?? 0,
      refsTotal: totalWarehouseRefs[id] ?? 0,
    })),
    channels: channelRows.map((ch) => ({
      id:            ch.id,
      label:         ch.name,
      refsForSale:   listingCounts[ch.id] ?? 0,
      googleAdsCampaignsProgrammed: googleAdsCampaignsProgrammedByChannel[ch.id] ?? 0,
      sales24hCents: sales24hByChannel[ch.id] ?? 0,
      connectorType: ch.connectorType,
    })),
    readyToPush: {
      count: readyCountRow[0]?.total ?? 0,
      skus: readyRows.map((r) => r.id),
    },
    wizhard: {
      productsToFill: productsToFillRows[0]?.total ?? 0,
    },
    suppliers: {
      lastInvoiceDate: lastInvoiceRows[0]?.lastInvoiceDate ?? null,
    },
    lastPush,
  })
}
