import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  adsAccounts,
  adsCampaignDailyMetrics,
  adsCampaignKpiDaily,
  adsCampaigns,
  adsProviders,
  salesOrderItems,
  salesOrders,
  shopifySkuDailyMetrics,
} from '@/lib/db/schema'

interface RebuildOptions {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

interface CuratedFilters {
  from: string
  to: string
  providerId?: string
  campaignPk?: number
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dayStart(date: string): string {
  return `${date}T00:00:00.000Z`
}

function dayEnd(date: string): string {
  return `${date}T23:59:59.999Z`
}

function* dates(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  while (d <= end) {
    yield d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
}

export async function rebuildAdsCuratedAnalytics(options: RebuildOptions): Promise<{
  from: string
  to: string
  shopifySkuRows: number
  kpiRows: number
}> {
  if (!isYmd(options.from) || !isYmd(options.to)) {
    throw new Error('from/to must be YYYY-MM-DD')
  }
  if (options.from > options.to) {
    throw new Error('from must be <= to')
  }

  const sales = await db.query.salesOrders.findMany({
    where: and(
      gte(salesOrders.orderCreatedAt, dayStart(options.from)),
      lte(salesOrders.orderCreatedAt, dayEnd(options.to)),
      inArray(salesOrders.channelId, ['shopify_komputerzz', 'shopify_tiktok'])
    ),
    columns: {
      orderPk: true,
      orderCreatedAt: true,
      channelId: true,
      refundedAmountCents: true,
    },
  })

  const orderPks = sales.map((s) => s.orderPk)
  const items = orderPks.length > 0
    ? await db.query.salesOrderItems.findMany({
      where: inArray(salesOrderItems.orderPk, orderPks),
      columns: {
        orderPk: true,
        sku: true,
        quantity: true,
        lineTotalAmountCents: true,
        lineSubtotalAmountCents: true,
      },
    })
    : []

  const orderMeta = new Map<number, { date: string; channelId: string; refunded: number }>()
  for (const o of sales) {
    orderMeta.set(o.orderPk, {
      date: (o.orderCreatedAt ?? '').slice(0, 10),
      channelId: o.channelId,
      refunded: o.refundedAmountCents ?? 0,
    })
  }

  type ShopAgg = {
    orders: Set<number>
    units: number
    gross: number
    refunded: number
  }
  const shopAgg = new Map<string, ShopAgg>()
  for (const it of items) {
    if (!it.sku) continue
    const meta = orderMeta.get(it.orderPk)
    if (!meta || !meta.date) continue
    const key = `${meta.date}|${meta.channelId}|${it.sku}`
    const cur = shopAgg.get(key) ?? { orders: new Set<number>(), units: 0, gross: 0, refunded: 0 }
    cur.orders.add(it.orderPk)
    cur.units += it.quantity ?? 0
    cur.gross += (it.lineTotalAmountCents ?? it.lineSubtotalAmountCents ?? 0)
    shopAgg.set(key, cur)
  }

  let shopifySkuRows = 0
  for (const [key, agg] of shopAgg.entries()) {
    const [metricDate, channelId, productSku] = key.split('|')
    const net = agg.gross - agg.refunded
    await db.insert(shopifySkuDailyMetrics).values({
      metricDate,
      channelId,
      productSku,
      ordersCount: agg.orders.size,
      unitsSold: agg.units,
      grossRevenueCents: agg.gross,
      refundedCents: agg.refunded,
      netRevenueCents: net,
      sourceJson: JSON.stringify({ model: 'from_sales_orders_items' }),
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [shopifySkuDailyMetrics.metricDate, shopifySkuDailyMetrics.channelId, shopifySkuDailyMetrics.productSku],
      set: {
        ordersCount: agg.orders.size,
        unitsSold: agg.units,
        grossRevenueCents: agg.gross,
        refundedCents: agg.refunded,
        netRevenueCents: net,
        sourceJson: JSON.stringify({ model: 'from_sales_orders_items' }),
        updatedAt: new Date().toISOString(),
      },
    })
    shopifySkuRows++
  }

  const campaigns = await db.query.adsCampaigns.findMany({
    where: and(
      lte(sql`coalesce(${adsCampaigns.startAt}, '9999-12-31T00:00:00.000Z')`, dayEnd(options.to)),
      gte(sql`coalesce(${adsCampaigns.endAt}, '0001-01-01T00:00:00.000Z')`, dayStart(options.from))
    ),
    columns: {
      campaignPk: true,
      accountPk: true,
      productSku: true,
      startAt: true,
      endAt: true,
    },
  })

  const accountIds = Array.from(new Set(campaigns.map((c) => c.accountPk)))
  const accounts = accountIds.length
    ? await db.query.adsAccounts.findMany({
      where: inArray(adsAccounts.accountPk, accountIds),
      columns: { accountPk: true, providerId: true },
    })
    : []
  const accountProvider = new Map(accounts.map((a) => [a.accountPk, a.providerId]))

  const providerMetrics = await db.query.adsCampaignDailyMetrics.findMany({
    where: and(
      gte(adsCampaignDailyMetrics.metricDate, options.from),
      lte(adsCampaignDailyMetrics.metricDate, options.to),
    ),
    columns: {
      campaignPk: true,
      metricDate: true,
      impressions: true,
      clicks: true,
      spendCents: true,
      conversions: true,
      conversionValueCents: true,
      providerId: true,
      accountPk: true,
    },
  })

  const providerMap = new Map<string, typeof providerMetrics[number]>()
  for (const m of providerMetrics) {
    providerMap.set(`${m.campaignPk}|${m.metricDate}`, m)
  }

  const shopRows = await db.query.shopifySkuDailyMetrics.findMany({
    where: and(
      gte(shopifySkuDailyMetrics.metricDate, options.from),
      lte(shopifySkuDailyMetrics.metricDate, options.to),
    ),
    columns: {
      metricDate: true,
      productSku: true,
      ordersCount: true,
      unitsSold: true,
      netRevenueCents: true,
    },
  })

  const shopMap = new Map<string, { orders: number; units: number; net: number }>()
  for (const s of shopRows) {
    const key = `${s.metricDate}|${s.productSku}`
    const cur = shopMap.get(key) ?? { orders: 0, units: 0, net: 0 }
    cur.orders += s.ordersCount
    cur.units += s.unitsSold
    cur.net += s.netRevenueCents
    shopMap.set(key, cur)
  }

  let kpiRows = 0
  for (const c of campaigns) {
    if (!c.productSku) continue
    const providerId = accountProvider.get(c.accountPk) ?? 'google_ads'
    const start = (c.startAt ?? dayStart(options.from)).slice(0, 10)
    const end = (c.endAt ?? dayEnd(options.to)).slice(0, 10)
    const from = start > options.from ? start : options.from
    const to = end < options.to ? end : options.to

    for (const metricDate of dates(from, to)) {
      const pm = providerMap.get(`${c.campaignPk}|${metricDate}`)
      const sm = shopMap.get(`${metricDate}|${c.productSku}`) ?? { orders: 0, units: 0, net: 0 }

      const spend = pm?.spendCents ?? 0
      const clicks = pm?.clicks ?? 0
      const impressions = pm?.impressions ?? 0
      const providerConversions = pm?.conversions ?? 0
      const providerConvValue = pm?.conversionValueCents ?? 0
      const roas = spend > 0 ? sm.net / spend : null
      const cpa = providerConversions > 0 ? Math.round(spend / providerConversions) : null
      const ctr = impressions > 0 ? clicks / impressions : null
      const cpc = clicks > 0 ? Math.round(spend / clicks) : null

      await db.insert(adsCampaignKpiDaily).values({
        campaignPk: c.campaignPk,
        metricDate,
        providerId,
        accountPk: c.accountPk,
        productSku: c.productSku,
        spendCents: spend,
        clicks,
        impressions,
        providerConversions,
        providerConversionValueCents: providerConvValue,
        shopifyOrders: sm.orders,
        shopifyUnits: sm.units,
        shopifyNetRevenueCents: sm.net,
        roas,
        cpaCents: cpa,
        ctr,
        cpcCents: cpc,
        attributionModel: 'sku_time_window_proxy',
        attributionConfidence: 0.35,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [adsCampaignKpiDaily.campaignPk, adsCampaignKpiDaily.metricDate],
        set: {
          providerId,
          accountPk: c.accountPk,
          productSku: c.productSku,
          spendCents: spend,
          clicks,
          impressions,
          providerConversions,
          providerConversionValueCents: providerConvValue,
          shopifyOrders: sm.orders,
          shopifyUnits: sm.units,
          shopifyNetRevenueCents: sm.net,
          roas,
          cpaCents: cpa,
          ctr,
          cpcCents: cpc,
          attributionModel: 'sku_time_window_proxy',
          attributionConfidence: 0.35,
          updatedAt: new Date().toISOString(),
        },
      })
      kpiRows++
    }
  }

  return { from: options.from, to: options.to, shopifySkuRows, kpiRows }
}

export async function getCuratedAdsAnalytics(filters: CuratedFilters) {
  const rows = await db.select({
    metricDate: adsCampaignKpiDaily.metricDate,
    providerId: adsCampaignKpiDaily.providerId,
    providerLabel: adsProviders.label,
    accountPk: adsCampaignKpiDaily.accountPk,
    accountName: adsAccounts.accountName,
    campaignPk: adsCampaignKpiDaily.campaignPk,
    campaignName: adsCampaigns.name,
    productSku: adsCampaignKpiDaily.productSku,
    spendCents: adsCampaignKpiDaily.spendCents,
    impressions: adsCampaignKpiDaily.impressions,
    clicks: adsCampaignKpiDaily.clicks,
    providerConversions: adsCampaignKpiDaily.providerConversions,
    providerConversionValueCents: adsCampaignKpiDaily.providerConversionValueCents,
    shopifyOrders: adsCampaignKpiDaily.shopifyOrders,
    shopifyUnits: adsCampaignKpiDaily.shopifyUnits,
    shopifyNetRevenueCents: adsCampaignKpiDaily.shopifyNetRevenueCents,
    roas: adsCampaignKpiDaily.roas,
    cpaCents: adsCampaignKpiDaily.cpaCents,
    ctr: adsCampaignKpiDaily.ctr,
    cpcCents: adsCampaignKpiDaily.cpcCents,
    attributionModel: adsCampaignKpiDaily.attributionModel,
    attributionConfidence: adsCampaignKpiDaily.attributionConfidence,
  })
    .from(adsCampaignKpiDaily)
    .innerJoin(adsCampaigns, eq(adsCampaigns.campaignPk, adsCampaignKpiDaily.campaignPk))
    .innerJoin(adsAccounts, eq(adsAccounts.accountPk, adsCampaignKpiDaily.accountPk))
    .innerJoin(adsProviders, eq(adsProviders.providerId, adsCampaignKpiDaily.providerId))
    .where(and(
      gte(adsCampaignKpiDaily.metricDate, filters.from),
      lte(adsCampaignKpiDaily.metricDate, filters.to),
      filters.providerId ? eq(adsCampaignKpiDaily.providerId, filters.providerId) : undefined,
      filters.campaignPk ? eq(adsCampaignKpiDaily.campaignPk, filters.campaignPk) : undefined,
    ))
    .orderBy(desc(adsCampaignKpiDaily.metricDate), asc(adsCampaignKpiDaily.campaignPk))

  const summary = await db.select({
    spendCents: sql<number>`coalesce(sum(${adsCampaignKpiDaily.spendCents}),0)`,
    shopifyNetRevenueCents: sql<number>`coalesce(sum(${adsCampaignKpiDaily.shopifyNetRevenueCents}),0)`,
    clicks: sql<number>`coalesce(sum(${adsCampaignKpiDaily.clicks}),0)`,
    impressions: sql<number>`coalesce(sum(${adsCampaignKpiDaily.impressions}),0)`,
    providerConversions: sql<number>`coalesce(sum(${adsCampaignKpiDaily.providerConversions}),0)`,
    shopifyOrders: sql<number>`coalesce(sum(${adsCampaignKpiDaily.shopifyOrders}),0)`,
  })
    .from(adsCampaignKpiDaily)
    .where(and(
      gte(adsCampaignKpiDaily.metricDate, filters.from),
      lte(adsCampaignKpiDaily.metricDate, filters.to),
      filters.providerId ? eq(adsCampaignKpiDaily.providerId, filters.providerId) : undefined,
      filters.campaignPk ? eq(adsCampaignKpiDaily.campaignPk, filters.campaignPk) : undefined,
    ))

  const s = summary[0] ?? {
    spendCents: 0, shopifyNetRevenueCents: 0, clicks: 0, impressions: 0, providerConversions: 0, shopifyOrders: 0,
  }
  const roas = s.spendCents > 0 ? s.shopifyNetRevenueCents / s.spendCents : null
  const ctr = s.impressions > 0 ? s.clicks / s.impressions : null
  const cpcCents = s.clicks > 0 ? Math.round(s.spendCents / s.clicks) : null
  const cpaCents = s.providerConversions > 0 ? Math.round(s.spendCents / s.providerConversions) : null

  return {
    rows,
    summary: {
      ...s,
      roas,
      ctr,
      cpcCents,
      cpaCents,
      attributionModel: 'sku_time_window_proxy',
      attributionConfidence: 0.35,
    },
  }
}
