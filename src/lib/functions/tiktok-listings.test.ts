import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('./tiktok-api', () => ({ tiktokApiCall: vi.fn() }))

import { flattenProducts, planPricePush, samePrice, type ListingRow } from './tiktok-listings'

const row = (o: Partial<ListingRow>): ListingRow => ({
  productId: 'GP.BAG11.034', region: 'FR', price: 29.9, forSale: true,
  tiktokProductId: 'p1', tiktokSkuId: 's1', livePrice: 26.9, currency: 'EUR', ...o,
})

describe('flattenProducts', () => {
  it('keeps one entry per SKU with a seller_sku and parses the price', () => {
    const out = flattenProducts([
      { id: 'p1', status: 'ACTIVATE', audit: { status: 'APPROVED' },
        skus: [{ id: 's1', seller_sku: 'A', price: { currency: 'EUR', sale_price: '26.9', tax_exclusive_price: '26.9' } },
               { id: 's2', price: { currency: 'EUR', sale_price: '1' } }] },
      { id: 'p2', product_status: 'DRAFT', skus: [{ id: 's3', seller_sku: 'B', price: { currency: 'EUR', tax_exclusive_price: '9.5' } }] },
      { skus: [{ id: 'x', seller_sku: 'C' }] },
    ])
    expect(out).toEqual([
      { sellerSku: 'A', tiktokProductId: 'p1', tiktokSkuId: 's1', price: 26.9, currency: 'EUR', status: 'ACTIVATE', auditStatus: 'APPROVED' },
      { sellerSku: 'B', tiktokProductId: 'p2', tiktokSkuId: 's3', price: 9.5, currency: 'EUR', status: 'DRAFT', auditStatus: null },
    ])
  })
})

describe('samePrice', () => {
  it('treats sub-cent differences as equal', () => {
    expect(samePrice(26.9, 26.900001)).toBe(true)
    expect(samePrice(26.9, 26.91)).toBe(false)
    expect(samePrice(null, null)).toBe(true)
    expect(samePrice(1, null)).toBe(false)
  })
})

describe('planPricePush', () => {
  it('pushes a differing FR price', () => {
    const { push, skipped } = planPricePush([row({})])
    expect(push).toEqual([{ productId: 'GP.BAG11.034', region: 'FR', tiktokProductId: 'p1', tiktokSkuId: 's1', from: 26.9, to: 29.9, currency: 'EUR' }])
    expect(skipped).toEqual([])
  })
  it('does nothing when the live price already matches or no price is wanted', () => {
    expect(planPricePush([row({ livePrice: 29.9 }), row({ price: null })]).push).toEqual([])
  })
  it('never pushes IE, even when asked', () => {
    const { push, skipped } = planPricePush([row({ region: 'IE' })], { regions: ['IE'] })
    expect(push).toEqual([])
    expect(skipped[0].reason).toMatch(/Shopify/)
  })
  it('skips rows not for sale or without a TikTok listing, and says why', () => {
    const { push, skipped } = planPricePush([
      row({ productId: 'A', forSale: false }),
      row({ productId: 'B', tiktokProductId: null }),
    ])
    expect(push).toEqual([])
    expect(skipped.map((s) => s.productId)).toEqual(['A', 'B'])
  })
  it('filters by region and sku', () => {
    const rows = [row({ productId: 'A', region: 'FR' }), row({ productId: 'B', region: 'ES' }), row({ productId: 'C', region: 'IT' })]
    expect(planPricePush(rows, { regions: ['es'] }).push.map((p) => p.productId)).toEqual(['B'])
    expect(planPricePush(rows, { skus: ['C'] }).push.map((p) => p.productId)).toEqual(['C'])
  })
})
