/**
 * Per-shop TikTok listings and prices.
 *
 * Ragequit sells on 4 TikTok shops: IE (home shop, linked to the Shopify "Tech Store") and the Sell Across
 * Europe shops FR/ES/IT. Prices differ per country and are set by hand — no automatic conversion rule.
 *
 *  - IE: the price comes from Shopify (product_prices.shopify_tiktok → Shopify → TikTok). Wizhard never
 *    writes the IE price straight to TikTok (writes go through Shopify whenever Shopify can carry them).
 *  - FR/ES/IT: Shopify cannot carry a per-shop price, so Wizhard stores it here and pushes it with
 *    POST /product/202309/products/{id}/prices/update — no new audit for a live listing (tested 17/11/2026).
 *
 * `refreshListings` reads every shop (products/search) and records what TikTok shows (live_*);
 * `pushPrices` sends the wanted prices that differ from the live ones, then re-reads each product.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { products, productPrices, tiktokShopListings } from '@/lib/db/schema'
import { tiktokApiCall } from './tiktok-api'

export const TIKTOK_REGIONS = ['IE', 'FR', 'ES', 'IT'] as const
export type TiktokRegion = (typeof TIKTOK_REGIONS)[number]
/** Shops whose price Wizhard pushes directly. IE is priced through Shopify. */
export const PRICE_PUSH_REGIONS: readonly TiktokRegion[] = ['FR', 'ES', 'IT']

export function isTiktokRegion(r: string): r is TiktokRegion {
  return (TIKTOK_REGIONS as readonly string[]).includes(r)
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export interface LiveSku {
  sellerSku: string
  tiktokProductId: string
  tiktokSkuId: string
  price: number | null
  currency: string | null
  status: string | null
  auditStatus: string | null
}

interface RawSku {
  id?: string
  seller_sku?: string
  price?: { currency?: string; sale_price?: string; tax_exclusive_price?: string }
}
interface RawProduct {
  id?: string
  status?: string
  product_status?: string
  audit?: { status?: string }
  skus?: RawSku[]
}

function toPrice(p: RawSku['price']): number | null {
  const raw = p?.sale_price ?? p?.tax_exclusive_price
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Flatten TikTok products (search results or a single product) into one entry per SKU with a seller_sku. */
export function flattenProducts(list: RawProduct[]): LiveSku[] {
  const out: LiveSku[] = []
  for (const p of list) {
    if (!p?.id) continue
    for (const s of p.skus ?? []) {
      if (!s?.id || !s.seller_sku) continue
      out.push({
        sellerSku: s.seller_sku,
        tiktokProductId: p.id,
        tiktokSkuId: s.id,
        price: toPrice(s.price),
        currency: s.price?.currency ?? null,
        status: p.status ?? p.product_status ?? null,
        auditStatus: p.audit?.status ?? null,
      })
    }
  }
  return out
}

export interface ListingRow {
  productId: string
  region: string
  price: number | null
  forSale: boolean
  tiktokProductId: string | null
  tiktokSkuId: string | null
  livePrice: number | null
  currency?: string | null
}

export interface PricePushItem {
  productId: string
  region: TiktokRegion
  tiktokProductId: string
  tiktokSkuId: string
  from: number | null
  to: number
  currency: string
}

export interface PricePushSkip { productId: string; region: string; reason: string }

/** Prices differ when they are more than half a cent apart. */
export function samePrice(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.005
}

/**
 * Which prices to send. A row is pushed when its region is pushable, it is for sale, has a wanted
 * price, is mapped to a TikTok SKU, and the live price differs. Everything else that has a wanted price
 * but cannot be sent is reported as skipped, so nothing is silently ignored.
 */
export function planPricePush(
  rows: ListingRow[],
  opts: { regions?: string[]; skus?: string[] } = {},
): { push: PricePushItem[]; skipped: PricePushSkip[] } {
  const regions = new Set((opts.regions ?? PRICE_PUSH_REGIONS).map((r) => r.toUpperCase()))
  const skus = opts.skus ? new Set(opts.skus) : null
  const push: PricePushItem[] = []
  const skipped: PricePushSkip[] = []
  for (const r of rows) {
    const region = r.region.toUpperCase()
    if (!regions.has(region)) continue
    if (skus && !skus.has(r.productId)) continue
    if (r.price === null) continue
    const skip = (reason: string) => skipped.push({ productId: r.productId, region, reason })
    if (!(PRICE_PUSH_REGIONS as readonly string[]).includes(region)) { skip('IE price is set in Shopify (shopify_tiktok), not pushed by Wizhard'); continue }
    if (!r.forSale) { skip('not for sale on this shop'); continue }
    if (!(r.price > 0)) { skip('price must be > 0'); continue }
    if (!r.tiktokProductId || !r.tiktokSkuId) { skip('no TikTok listing on this shop yet (run a refresh)'); continue }
    if (samePrice(r.price, r.livePrice)) continue
    push.push({
      productId: r.productId,
      region: region as TiktokRegion,
      tiktokProductId: r.tiktokProductId,
      tiktokSkuId: r.tiktokSkuId,
      from: r.livePrice,
      to: Math.round(r.price * 100) / 100,
      currency: r.currency ?? 'EUR',
    })
  }
  return { push, skipped }
}

// ---------------------------------------------------------------------------
// TikTok reads
// ---------------------------------------------------------------------------

/** Every product of one shop (POST products/search, paginated). */
export async function fetchShopProducts(region: TiktokRegion): Promise<RawProduct[]> {
  const all: RawProduct[] = []
  let pageToken = ''
  for (let page = 0; page < 50; page++) {
    const query: Record<string, string> = { page_size: '100' }
    if (pageToken) query.page_token = pageToken
    const data = (await tiktokApiCall('/product/202309/products/search', {
      method: 'POST', query, body: {}, useShopCipher: true, shopRegion: region,
    })) as { products?: RawProduct[]; next_page_token?: string }
    all.push(...(data.products ?? []))
    pageToken = data.next_page_token ?? ''
    if (!pageToken) break
  }
  return all
}

async function fetchProduct(region: TiktokRegion, tiktokProductId: string): Promise<RawProduct> {
  return (await tiktokApiCall(`/product/202309/products/${tiktokProductId}`, {
    method: 'GET', useShopCipher: true, shopRegion: region,
  })) as RawProduct
}

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

export async function listListings() {
  const rows = await db.select().from(tiktokShopListings)
  const ids = Array.from(new Set(rows.map((r) => r.productId)))
  const titles = ids.length
    ? await db.select({ id: products.id, title: products.title }).from(products).where(inArray(products.id, ids))
    : []
  const iePrices = ids.length
    ? await db.select({ productId: productPrices.productId, price: productPrices.price })
        .from(productPrices)
        .where(and(eq(productPrices.platform, 'shopify_tiktok'), inArray(productPrices.productId, ids)))
    : []
  const titleOf = new Map(titles.map((t) => [t.id, t.title]))
  const shopifyOf = new Map(iePrices.map((p) => [p.productId, p.price]))
  return ids.sort().map((id) => ({
    productId: id,
    title: titleOf.get(id) ?? null,
    shopifyTiktokPrice: shopifyOf.get(id) ?? null,
    shops: Object.fromEntries(rows.filter((r) => r.productId === id).map((r) => [r.region, r])),
  }))
}

export async function setListing(
  productId: string,
  region: TiktokRegion,
  patch: { price?: number | null; forSale?: boolean },
) {
  const now = new Date().toISOString()
  const values: Partial<typeof tiktokShopListings.$inferInsert> = { updatedAt: now }
  if (patch.price !== undefined) values.price = patch.price === null ? null : Math.round(patch.price * 100) / 100
  if (patch.forSale !== undefined) values.forSale = patch.forSale
  await db.insert(tiktokShopListings)
    .values({ productId, region, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: [tiktokShopListings.productId, tiktokShopListings.region], set: values })
}

export interface RefreshResult {
  region: TiktokRegion
  seen: number
  updated: number
  notFound: number
  unknownSkus: string[]
  error?: string
}

/** Read each shop and record live price/status per SKU. Never touches the wanted price or for_sale. */
export async function refreshListings(regions: TiktokRegion[] = [...TIKTOK_REGIONS]): Promise<RefreshResult[]> {
  const results: RefreshResult[] = []
  for (const region of regions) {
    const res: RefreshResult = { region, seen: 0, updated: 0, notFound: 0, unknownSkus: [] }
    try {
      const live = flattenProducts(await fetchShopProducts(region))
      res.seen = live.length
      const known = live.length
        ? new Set((await db.select({ id: products.id }).from(products)
            .where(inArray(products.id, Array.from(new Set(live.map((l) => l.sellerSku)))))).map((p) => p.id))
        : new Set<string>()
      const now = new Date().toISOString()
      for (const l of live) {
        if (!known.has(l.sellerSku)) { res.unknownSkus.push(l.sellerSku); continue }
        const liveCols = {
          tiktokProductId: l.tiktokProductId, tiktokSkuId: l.tiktokSkuId, livePrice: l.price,
          currency: l.currency, liveStatus: l.status, auditStatus: l.auditStatus, lastSeenAt: now, updatedAt: now,
        }
        await db.insert(tiktokShopListings)
          .values({ productId: l.sellerSku, region, ...liveCols })
          .onConflictDoUpdate({ target: [tiktokShopListings.productId, tiktokShopListings.region], set: liveCols })
        res.updated++
      }
      // Rows we know for this shop that TikTok no longer returns.
      const seen = new Set(live.map((l) => l.sellerSku))
      const existing = await db.select({ productId: tiktokShopListings.productId, tiktokProductId: tiktokShopListings.tiktokProductId })
        .from(tiktokShopListings).where(eq(tiktokShopListings.region, region))
      for (const e of existing) {
        if (seen.has(e.productId) || !e.tiktokProductId) continue
        await db.update(tiktokShopListings)
          .set({ liveStatus: 'NOT_FOUND', updatedAt: now })
          .where(and(eq(tiktokShopListings.productId, e.productId), eq(tiktokShopListings.region, region)))
        res.notFound++
      }
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err)
    }
    results.push(res)
  }
  return results
}

export interface PushResult {
  productId: string
  region: TiktokRegion
  from: number | null
  to: number
  ok: boolean
  livePriceAfter?: number | null
  error?: string
}

/** Send the wanted prices that differ from TikTok (FR/ES/IT only), then re-read each product. */
export async function pushPrices(opts: { regions?: string[]; skus?: string[]; dryRun?: boolean } = {}) {
  const rows = await db.select().from(tiktokShopListings)
  const plan = planPricePush(rows, opts)
  if (opts.dryRun) return { dryRun: true, ...plan, results: [] as PushResult[] }

  const results: PushResult[] = []
  for (const item of plan.push) {
    const r: PushResult = { productId: item.productId, region: item.region, from: item.from, to: item.to, ok: false }
    try {
      await tiktokApiCall(`/product/202309/products/${item.tiktokProductId}/prices/update`, {
        method: 'POST', useShopCipher: true, shopRegion: item.region,
        body: { skus: [{ id: item.tiktokSkuId, price: { amount: item.to.toFixed(2), currency: item.currency } }] },
      })
      const after = flattenProducts([await fetchProduct(item.region, item.tiktokProductId)])
        .find((s) => s.tiktokSkuId === item.tiktokSkuId)
      r.livePriceAfter = after?.price ?? null
      r.ok = samePrice(r.livePriceAfter, item.to)
      if (!r.ok) r.error = `TikTok shows ${r.livePriceAfter ?? '?'} after update`
      const now = new Date().toISOString()
      await db.update(tiktokShopListings)
        .set({
          livePrice: r.livePriceAfter, pricePushedAt: now, updatedAt: now,
          ...(after ? { liveStatus: after.status, auditStatus: after.auditStatus, lastSeenAt: now } : {}),
        })
        .where(and(eq(tiktokShopListings.productId, item.productId), eq(tiktokShopListings.region, item.region)))
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err)
    }
    results.push(r)
  }
  return { dryRun: false, ...plan, results }
}
