import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  rawChannelFulfillments,
  rawChannelOrders,
  rawChannelRefunds,
  rawChannelTransactions,
  salesChannels,
  salesFulfillmentItems,
  salesFulfillments,
  salesOrderItems,
  salesOrders,
  salesRefundItems,
  salesRefunds,
  salesSyncCursors,
  salesTransactions,
} from '@/lib/db/schema'
import { logOperation } from './log'
import { getStoredToken, refreshShopifyToken } from './tokens'
import { extractOrderMarketingSignals, upsertOrderAttribution } from './google-ads'
import type { TriggeredBy } from '@/types/platform'

type SalesImportChannel = 'coincart2' | 'shopify_komputerzz' | 'shopify_tiktok'

interface SalesImportOptions {
  channels?: SalesImportChannel[]
  since?: string | null
  limitPerChannel?: number
  triggeredBy?: TriggeredBy
}

interface ChannelImportResult {
  channelId: SalesImportChannel
  ok: boolean
  ordersFetched: number
  ordersUpserted: number
  orderItemsUpserted: number
  refundsUpserted: number
  refundItemsUpserted: number
  transactionsUpserted: number
  fulfillmentsUpserted: number
  fulfillmentItemsUpserted: number
  cursorFrom: string | null
  cursorTo: string | null
  error?: string
}

interface SalesImportResult {
  startedAt: string
  finishedAt: string
  channels: ChannelImportResult[]
}

function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

function boolToInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return value ? 1 : 0
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const parts = linkHeader.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed.includes('rel="next"')) continue
    const m = trimmed.match(/<([^>]+)>/)
    if (m?.[1]) return m[1]
  }
  return null
}

async function getChannelCursor(channelId: SalesImportChannel): Promise<string | null> {
  const row = await db.query.salesSyncCursors.findFirst({
    where: and(eq(salesSyncCursors.channelId, channelId), eq(salesSyncCursors.resourceType, 'orders')),
  })
  return row?.lastSourceUpdatedAt ?? null
}

async function upsertCursor(channelId: SalesImportChannel, cursorTo: string | null, status: 'success' | 'error', error?: string): Promise<void> {
  const now = new Date().toISOString()
  const resources = ['orders', 'refunds', 'transactions', 'fulfillments'] as const
  for (const resourceType of resources) {
    await db.insert(salesSyncCursors).values({
      channelId,
      resourceType,
      lastSourceUpdatedAt: cursorTo,
      lastExternalId: null,
      lastSyncAt: now,
      lastStatus: status,
      lastError: error ?? null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [salesSyncCursors.channelId, salesSyncCursors.resourceType],
      set: {
        lastSourceUpdatedAt: cursorTo,
        lastSyncAt: now,
        lastStatus: status,
        lastError: error ?? null,
        updatedAt: now,
      },
    })
  }
}

async function getShopifyToken(channelId: SalesImportChannel): Promise<string> {
  const platform = channelId === 'shopify_komputerzz' ? 'shopify_komputerzz' : 'shopify_tiktok'
  const stored = await getStoredToken(platform)
  if (stored) return stored

  const refreshed = await refreshShopifyToken(platform)
  if (!refreshed.ok) {
    throw new Error(`Unable to refresh Shopify token for ${channelId}: ${refreshed.error ?? 'unknown error'}`)
  }

  const storedAfterRefresh = await getStoredToken(platform)
  if (!storedAfterRefresh) {
    throw new Error(`Refreshed Shopify token for ${channelId} but no stored token was found`)
  }
  return storedAfterRefresh
}

async function fetchShopifyOrders(channelId: SalesImportChannel, since: string | null, limitPerChannel: number): Promise<any[]> {
  const shop = channelId === 'shopify_komputerzz'
    ? process.env.SHOPIFY_KOMPUTERZZ_SHOP
    : process.env.SHOPIFY_TIKTOK_SHOP
  if (!shop) throw new Error(`Missing shop domain for ${channelId}`)
  const token = await getShopifyToken(channelId)
  const collected: any[] = []

  let url = new URL(`https://${shop}/admin/api/2025-01/orders.json`)
  url.searchParams.set('status', 'any')
  url.searchParams.set('limit', '250')
  url.searchParams.set('order', 'updated_at asc')
  if (since) url.searchParams.set('updated_at_min', since)

  while (url && collected.length < limitPerChannel) {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Wizhard/1.0',
      },
    })
    if (!res.ok) {
      throw new Error(`Shopify orders fetch failed for ${channelId}: ${res.status} ${await res.text()}`)
    }
    const json = await res.json() as { orders?: any[] }
    const batch = json.orders ?? []
    collected.push(...batch)
    const next = parseNextLink(res.headers.get('link'))
    if (!next || batch.length === 0) break
    url = new URL(next)
  }

  return collected.slice(0, limitPerChannel)
}

async function fetchShopifyTransactions(channelId: SalesImportChannel, orderId: string | number): Promise<any[]> {
  const shop = channelId === 'shopify_komputerzz'
    ? process.env.SHOPIFY_KOMPUTERZZ_SHOP
    : process.env.SHOPIFY_TIKTOK_SHOP
  if (!shop) throw new Error(`Missing shop domain for ${channelId}`)
  const token = await getShopifyToken(channelId)
  const res = await fetch(`https://${shop}/admin/api/2025-01/orders/${orderId}/transactions.json`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'User-Agent': 'Wizhard/1.0',
    },
  })
  if (!res.ok) return []
  const json = await res.json() as { transactions?: any[] }
  return json.transactions ?? []
}

async function fetchWooOrders(since: string | null, limitPerChannel: number): Promise<any[]> {
  const siteUrl = process.env.COINCART_URL
  const ck = process.env.COINCART_KEY
  const cs = process.env.COINCART_SECRET
  if (!siteUrl || !ck || !cs) throw new Error('Missing Coincart credentials')

  const collected: any[] = []
  let page = 1
  while (collected.length < limitPerChannel) {
    const url = new URL(`${siteUrl}/wp-json/wc/v3/orders`)
    url.searchParams.set('consumer_key', ck)
    url.searchParams.set('consumer_secret', cs)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    url.searchParams.set('status', 'any')
    url.searchParams.set('orderby', 'date')
    url.searchParams.set('order', 'asc')
    if (since) url.searchParams.set('modified_after', since)

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Wizhard/1.0',
      },
    })
    if (!res.ok) {
      throw new Error(`Coincart orders fetch failed: ${res.status} ${await res.text()}`)
    }
    const batch = await res.json() as any[]
    collected.push(...batch)
    if (batch.length < 100) break
    page++
  }

  return collected.slice(0, limitPerChannel)
}

async function upsertOrderAndItems(channelId: SalesImportChannel, platform: string, order: any): Promise<{ orderPk: number; itemsCount: number; orderCreatedAt: string }> {
  const externalOrderId = asString(order.admin_graphql_api_id ?? order.id)
  if (!externalOrderId) throw new Error(`Order without external ID on ${channelId}`)
  const sourceUpdatedAt = asString(order.updated_at ?? order.date_modified_gmt ?? order.date_modified)
    ?? new Date().toISOString()
  const sourceCreatedAt = asString(order.created_at ?? order.date_created_gmt ?? order.date_created)

  await db.insert(rawChannelOrders).values({
    channelId,
    platform,
    externalOrderId,
    externalOrderName: asString(order.name ?? order.number),
    sourceCreatedAt,
    sourceUpdatedAt,
    payloadJson: JSON.stringify(order),
    payloadChecksum: null,
    syncedAt: new Date().toISOString(),
  }).onConflictDoNothing()

  const customer = order.customer ?? {}
  const billing = order.billing_address ?? order.billing ?? {}
  const shipping = order.shipping_address ?? order.shipping ?? {}
  const tags = Array.isArray(order.tags) ? order.tags.join(',') : asString(order.tags)

  const totalCents = toCents(order.current_total_price ?? order.total)
  const refundedCents = toCents(order.total_refunds ?? order.total_refunded) ?? 0
  const shippingCents = toCents(
    order.total_shipping
      ?? order.shipping_total
      ?? order.total_shipping_price_set?.shop_money?.amount
  )
  const subtotalCents = toCents(order.current_subtotal_price ?? order.subtotal_price)
  const discountCents = toCents(order.current_total_discounts ?? order.discount_total)
  const taxCents = toCents(order.current_total_tax ?? order.total_tax)

  const orderCreatedAt = sourceCreatedAt ?? sourceUpdatedAt
  await db.insert(salesOrders).values({
    channelId,
    externalOrderId,
    externalOrderName: asString(order.name ?? order.number),
    platform,
    externalCheckoutId: asString(order.checkout_id),
    customerExternalId: asString(customer.id ?? order.customer_id),
    customerEmail: asString(customer.email ?? order.email ?? billing.email),
    customerName: asString(
      customer.first_name && customer.last_name
        ? `${customer.first_name} ${customer.last_name}`
        : (customer.name ?? ((billing.first_name && billing.last_name) ? `${billing.first_name} ${billing.last_name}` : null))
    ),
    customerPhone: asString(customer.phone ?? billing.phone),
    currencyCode: asString(order.currency),
    financialStatus: asString(order.financial_status),
    fulfillmentStatus: asString(order.fulfillment_status),
    orderStatus: asString(order.status),
    sourceName: asString(order.source_name ?? order.created_via),
    cancelReason: asString(order.cancel_reason),
    isTestOrder: boolToInt(order.test) ?? 0,
    orderCreatedAt,
    orderProcessedAt: asString(order.processed_at ?? order.date_paid_gmt),
    orderUpdatedAt: sourceUpdatedAt,
    orderCancelledAt: asString(order.cancelled_at),
    orderClosedAt: asString(order.closed_at ?? order.date_completed_gmt),
    subtotalAmountCents: subtotalCents,
    discountAmountCents: discountCents,
    shippingAmountCents: shippingCents,
    taxAmountCents: taxCents,
    totalAmountCents: totalCents,
    refundedAmountCents: refundedCents,
    netAmountCents: totalCents != null ? totalCents - refundedCents : null,
    shippingName: asString(shipping.name ?? (shipping.first_name && shipping.last_name ? `${shipping.first_name} ${shipping.last_name}` : null)),
    shippingCity: asString(shipping.city),
    shippingRegion: asString(shipping.province ?? shipping.state),
    shippingCountry: asString(shipping.country),
    shippingPostalCode: asString(shipping.zip ?? shipping.postcode),
    billingName: asString(billing.name ?? (billing.first_name && billing.last_name ? `${billing.first_name} ${billing.last_name}` : null)),
    billingCity: asString(billing.city),
    billingRegion: asString(billing.province ?? billing.state),
    billingCountry: asString(billing.country),
    billingPostalCode: asString(billing.zip ?? billing.postcode),
    tags,
    note: asString(order.note ?? order.customer_note),
    rawSourceTable: 'raw_channel_orders',
    rawSourceId: externalOrderId,
    insertedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [salesOrders.channelId, salesOrders.externalOrderId],
    set: {
      externalOrderName: asString(order.name ?? order.number),
      financialStatus: asString(order.financial_status),
      fulfillmentStatus: asString(order.fulfillment_status),
      orderStatus: asString(order.status),
      orderUpdatedAt: sourceUpdatedAt,
      orderCancelledAt: asString(order.cancelled_at),
      orderClosedAt: asString(order.closed_at ?? order.date_completed_gmt),
      subtotalAmountCents: subtotalCents,
      discountAmountCents: discountCents,
      shippingAmountCents: shippingCents,
      taxAmountCents: taxCents,
      totalAmountCents: totalCents,
      refundedAmountCents: refundedCents,
      netAmountCents: totalCents != null ? totalCents - refundedCents : null,
      tags,
      note: asString(order.note ?? order.customer_note),
      updatedAt: new Date().toISOString(),
    },
  })

  const savedOrder = await db.query.salesOrders.findFirst({
    where: and(
      eq(salesOrders.channelId, channelId),
      eq(salesOrders.externalOrderId, externalOrderId)
    ),
    columns: { orderPk: true },
  })
  if (!savedOrder) throw new Error(`Unable to load saved order for ${externalOrderId}`)

  await db.delete(salesOrderItems).where(eq(salesOrderItems.orderPk, savedOrder.orderPk))
  const lines = (order.line_items ?? []) as any[]
  for (const line of lines) {
    await db.insert(salesOrderItems).values({
      orderPk: savedOrder.orderPk,
      externalLineItemId: asString(line.id),
      externalProductId: asString(line.product_id),
      externalVariantId: asString(line.variant_id ?? line.variation_id),
      sku: asString(line.sku),
      productKey: asString(line.sku),
      productTitle: asString(line.title ?? line.name),
      variantTitle: asString(line.variant_title),
      vendor: asString(line.vendor),
      quantity: Number(line.quantity ?? 0),
      currentQuantity: line.current_quantity != null ? Number(line.current_quantity) : null,
      refundableQuantity: line.refundable_quantity != null
        ? Number(line.refundable_quantity)
        : (line.fulfillable_quantity != null ? Number(line.fulfillable_quantity) : null),
      unitPriceAmountCents: toCents(line.price),
      lineSubtotalAmountCents: toCents(line.subtotal ?? line.total),
      lineDiscountAmountCents: toCents(line.total_discount),
      lineTotalAmountCents: toCents(line.total ?? line.line_price),
      requiresShipping: boolToInt(line.requires_shipping),
      taxable: boolToInt(line.taxable),
      fulfillmentStatus: asString(line.fulfillment_status),
      insertedAt: new Date().toISOString(),
    })
  }

  return { orderPk: savedOrder.orderPk, itemsCount: lines.length, orderCreatedAt }
}

async function replaceRefundsForOrder(channelId: SalesImportChannel, platform: string, order: any, orderPk: number): Promise<number> {
  await db.delete(salesRefunds).where(eq(salesRefunds.orderPk, orderPk))

  const refunds = (order.refunds ?? []) as any[]
  for (const refund of refunds) {
    const externalRefundId = asString(refund.id)
    if (!externalRefundId) continue
    await db.insert(rawChannelRefunds).values({
      channelId,
      platform,
      externalRefundId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id) ?? '',
      sourceCreatedAt: asString(refund.created_at),
      sourceUpdatedAt: asString(refund.processed_at ?? refund.created_at) ?? new Date().toISOString(),
      payloadJson: JSON.stringify(refund),
      payloadChecksum: null,
      syncedAt: new Date().toISOString(),
    }).onConflictDoNothing()

    await db.insert(salesRefunds).values({
      orderPk,
      channelId,
      externalRefundId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id) ?? '',
      currencyCode: asString(order.currency),
      refundCreatedAt: asString(refund.created_at),
      refundProcessedAt: asString(refund.processed_at),
      refundTotalAmountCents: toCents(refund.total ?? refund.amount),
      refundNotes: asString(refund.note ?? refund.reason),
      rawSourceTable: 'raw_channel_refunds',
      rawSourceId: externalRefundId,
      insertedAt: new Date().toISOString(),
    })

    const savedRefund = await db.query.salesRefunds.findFirst({
      where: and(
        eq(salesRefunds.channelId, channelId),
        eq(salesRefunds.externalRefundId, externalRefundId)
      ),
      columns: { refundPk: true },
    })
    if (!savedRefund) continue

    const refundLines = (refund.refund_line_items ?? []) as any[]
    for (const line of refundLines) {
      await db.insert(salesRefundItems).values({
        refundPk: savedRefund.refundPk,
        orderItemPk: null,
        externalRefundLineItemId: asString(line.id),
        externalLineItemId: asString(line.line_item_id ?? line.line_item?.id),
        sku: asString(line.line_item?.sku),
        quantity: line.quantity != null ? Number(line.quantity) : null,
        subtotalAmountCents: toCents(line.subtotal),
        taxAmountCents: toCents(line.total_tax),
      })
    }
  }

  return refunds.length
}

async function replaceFulfillmentsForOrder(channelId: SalesImportChannel, platform: string, order: any, orderPk: number): Promise<{ fulfillments: number; items: number }> {
  await db.delete(salesFulfillments).where(eq(salesFulfillments.orderPk, orderPk))

  const fulfillments = (order.fulfillments ?? []) as any[]
  let itemCount = 0
  for (const f of fulfillments) {
    const externalFulfillmentId = asString(f.id)
    if (!externalFulfillmentId) continue

    await db.insert(rawChannelFulfillments).values({
      channelId,
      platform,
      externalFulfillmentId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id) ?? '',
      sourceCreatedAt: asString(f.created_at),
      sourceUpdatedAt: asString(f.updated_at ?? f.created_at) ?? new Date().toISOString(),
      payloadJson: JSON.stringify(f),
      payloadChecksum: null,
      syncedAt: new Date().toISOString(),
    }).onConflictDoNothing()

    await db.insert(salesFulfillments).values({
      orderPk,
      channelId,
      externalFulfillmentId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id),
      status: asString(f.status),
      trackingCompany: asString(f.tracking_company),
      trackingNumber: asString(f.tracking_number),
      trackingUrl: asString(
        Array.isArray(f.tracking_urls) && f.tracking_urls.length > 0
          ? f.tracking_urls[0]
          : f.tracking_url
      ),
      fulfillmentCreatedAt: asString(f.created_at),
      fulfillmentUpdatedAt: asString(f.updated_at),
      rawSourceTable: 'raw_channel_fulfillments',
      rawSourceId: externalFulfillmentId,
      insertedAt: new Date().toISOString(),
    })

    const saved = await db.query.salesFulfillments.findFirst({
      where: and(
        eq(salesFulfillments.channelId, channelId),
        eq(salesFulfillments.externalFulfillmentId, externalFulfillmentId)
      ),
      columns: { fulfillmentPk: true },
    })
    if (!saved) continue

    const lines = (f.line_items ?? []) as any[]
    for (const line of lines) {
      await db.insert(salesFulfillmentItems).values({
        fulfillmentPk: saved.fulfillmentPk,
        orderItemPk: null,
        externalLineItemId: asString(line.id),
        sku: asString(line.sku),
        quantity: line.quantity != null ? Number(line.quantity) : null,
      })
      itemCount++
    }
  }

  return { fulfillments: fulfillments.length, items: itemCount }
}

async function replaceTransactionsForOrder(channelId: SalesImportChannel, platform: string, order: any, orderPk: number): Promise<number> {
  await db.delete(salesTransactions).where(eq(salesTransactions.orderPk, orderPk))

  const orderTransactions = channelId.startsWith('shopify')
    ? await fetchShopifyTransactions(channelId, order.id)
    : [{
      id: order.transaction_id || `${order.id}-payment`,
      kind: 'sale',
      status: order.status,
      gateway: order.payment_method_title ?? order.payment_method,
      amount: order.total,
      currency: order.currency,
      created_at: order.date_paid_gmt ?? order.date_created_gmt ?? order.date_created,
    }]

  let count = 0
  for (const tr of orderTransactions) {
    const externalTransactionId = asString(tr.id)
    if (!externalTransactionId) continue

    await db.insert(rawChannelTransactions).values({
      channelId,
      platform,
      externalTransactionId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id),
      externalRefundId: asString(tr.refund_id),
      sourceCreatedAt: asString(tr.created_at),
      sourceUpdatedAt: asString(tr.created_at) ?? new Date().toISOString(),
      payloadJson: JSON.stringify(tr),
      payloadChecksum: null,
      syncedAt: new Date().toISOString(),
    }).onConflictDoNothing()

    await db.insert(salesTransactions).values({
      orderPk,
      refundPk: null,
      channelId,
      externalTransactionId,
      externalOrderId: asString(order.admin_graphql_api_id ?? order.id),
      kind: asString(tr.kind),
      status: asString(tr.status),
      gateway: asString(tr.gateway),
      amountCents: toCents(tr.amount),
      currencyCode: asString(tr.currency),
      transactionCreatedAt: asString(tr.created_at),
      rawSourceTable: 'raw_channel_transactions',
      rawSourceId: externalTransactionId,
      insertedAt: new Date().toISOString(),
    }).onConflictDoNothing()
    count++
  }

  return count
}

async function importOneChannel(channelId: SalesImportChannel, options: Required<Pick<SalesImportOptions, 'limitPerChannel'>> & { since: string | null; triggeredBy: TriggeredBy }): Promise<ChannelImportResult> {
  const cursorFrom = await getChannelCursor(channelId)
  const since = options.since ?? cursorFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const platform = channelId.startsWith('shopify') ? 'shopify' : 'coincart2'
  const result: ChannelImportResult = {
    channelId,
    ok: true,
    ordersFetched: 0,
    ordersUpserted: 0,
    orderItemsUpserted: 0,
    refundsUpserted: 0,
    refundItemsUpserted: 0,
    transactionsUpserted: 0,
    fulfillmentsUpserted: 0,
    fulfillmentItemsUpserted: 0,
    cursorFrom: cursorFrom ?? null,
    cursorTo: null,
  }

  try {
    const orders = channelId.startsWith('shopify')
      ? await fetchShopifyOrders(channelId, since, options.limitPerChannel)
      : await fetchWooOrders(since, options.limitPerChannel)
    result.ordersFetched = orders.length

    let maxUpdated = since
    for (const order of orders) {
      const updatedAt = asString(order.updated_at ?? order.date_modified_gmt ?? order.date_modified) ?? since
      if (updatedAt > maxUpdated) maxUpdated = updatedAt

      const { orderPk, itemsCount, orderCreatedAt } = await upsertOrderAndItems(channelId, platform, order)
      result.ordersUpserted++
      result.orderItemsUpserted += itemsCount
      const marketing = extractOrderMarketingSignals(order)
      await upsertOrderAttribution(orderPk, orderCreatedAt, marketing)
      const refunds = await replaceRefundsForOrder(channelId, platform, order, orderPk)
      result.refundsUpserted += refunds
      const fulfillments = await replaceFulfillmentsForOrder(channelId, platform, order, orderPk)
      result.fulfillmentsUpserted += fulfillments.fulfillments
      result.fulfillmentItemsUpserted += fulfillments.items
      const transactions = await replaceTransactionsForOrder(channelId, platform, order, orderPk)
      result.transactionsUpserted += transactions
    }

    // refund items count for reporting
    const orderRows = await db.query.salesOrders.findMany({
      where: eq(salesOrders.channelId, channelId),
      columns: { orderPk: true },
    })
    const orderPks = orderRows.map((r) => r.orderPk)
    if (orderPks.length > 0) {
      const refunds = await db.query.salesRefunds.findMany({
        where: inArray(salesRefunds.orderPk, orderPks),
        columns: { refundPk: true },
      })
      const refundPks = refunds.map((r) => r.refundPk)
      result.refundItemsUpserted = refundPks.length === 0
        ? 0
        : (await db.query.salesRefundItems.findMany({
          where: inArray(salesRefundItems.refundPk, refundPks),
          columns: { refundItemPk: true },
        })).length
    }

    result.cursorTo = maxUpdated
    await upsertCursor(channelId, maxUpdated, 'success')
    await logOperation({
      action: 'sales_import',
      status: 'success',
      platform: channelId,
      message: `fetched=${result.ordersFetched} upserted=${result.ordersUpserted} items=${result.orderItemsUpserted} refunds=${result.refundsUpserted} tx=${result.transactionsUpserted} fulfillments=${result.fulfillmentsUpserted}`,
      triggeredBy: options.triggeredBy,
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    result.ok = false
    result.error = message
    await upsertCursor(channelId, result.cursorTo ?? cursorFrom ?? since, 'error', message)
    await logOperation({
      action: 'sales_import',
      status: 'error',
      platform: channelId,
      message,
      triggeredBy: options.triggeredBy,
    })
    return result
  }
}

export async function importSalesData(options: SalesImportOptions = {}): Promise<SalesImportResult> {
  const startedAt = new Date().toISOString()
  const requested = options.channels?.length
    ? options.channels
    : (['coincart2', 'shopify_komputerzz', 'shopify_tiktok'] as SalesImportChannel[])

  const enabledRows = await db.query.salesChannels.findMany({
    where: and(
      eq(salesChannels.enabled, 1),
      inArray(salesChannels.id, requested)
    ),
    columns: { id: true },
  })
  const enabled = new Set(enabledRows.map((r) => r.id as SalesImportChannel))
  const channels = requested.filter((c) => enabled.has(c))

  const limitPerChannel = Math.max(1, Math.min(options.limitPerChannel ?? 500, 5000))
  const triggeredBy = options.triggeredBy ?? 'human'

  const results: ChannelImportResult[] = []
  for (const channelId of channels) {
    const r = await importOneChannel(channelId, {
      limitPerChannel,
      since: options.since ?? null,
      triggeredBy,
    })
    results.push(r)
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    channels: results,
  }
}

