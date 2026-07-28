import { describe, it, expect } from 'vitest'
import { computeReadiness, type ReadinessInput } from './tiktok-readiness'

const ALL_REQUIRED = [
  'title', 'description', 'price', 'ean', 'images',
  'category', 'attributes', 'package_dims', 'package_weight', 'gpsr',
]

const good: ReadinessInput = {
  title: 'Acer Predator Cestus 333 Gaming Mouse, 16000 DPI, 6 Buttons',
  description: 'x'.repeat(120),
  price: 39.9,
  ean: '4711474360199',
  categoryGid: 'gid://shopify/TaxonomyCategory/el-7-9-12-11',
  hasAttributes: true,
  packageLengthMm: 110, packageWidthMm: 90, packageHeightMm: 60,
  packageWeightG: 240,
  gpsrComplete: true,
  imagePassCount: 6, imageMainOk: true,
}

describe('computeReadiness', () => {
  it('passes a fully complete product', () => {
    expect(computeReadiness(good, ALL_REQUIRED)).toEqual({ ready: true, missing: [] })
  })

  it('flags a short title', () => {
    const r = computeReadiness({ ...good, title: 'Acer Mouse' }, ALL_REQUIRED)
    expect(r.ready).toBe(false)
    expect(r.missing).toEqual(['title'])
  })

  it('flags fewer than 5 passing images or a failing main image', () => {
    expect(computeReadiness({ ...good, imagePassCount: 4 }, ALL_REQUIRED).missing).toContain('images')
    expect(computeReadiness({ ...good, imageMainOk: false }, ALL_REQUIRED).missing).toContain('images')
  })

  it('flags the root category as not a real category', () => {
    const r = computeReadiness({ ...good, categoryGid: 'gid://shopify/TaxonomyCategory/el' }, ALL_REQUIRED)
    expect(r.missing).toContain('category')
  })

  it('flags a part number wrongly used as EAN', () => {
    const r = computeReadiness({ ...good, ean: 'GP.OTH11.074' }, ALL_REQUIRED)
    expect(r.missing).toContain('ean')
  })

  it('flags incomplete GPSR and missing package dims/weight', () => {
    const r = computeReadiness(
      { ...good, gpsrComplete: false, packageHeightMm: null, packageWeightG: 0 },
      ALL_REQUIRED,
    )
    expect(r.missing).toEqual(expect.arrayContaining(['gpsr', 'package_dims', 'package_weight']))
  })

  it('only evaluates the required keys it is given', () => {
    // description is short, but not in the required set -> still ready
    const r = computeReadiness({ ...good, description: 'short' }, ['title', 'price'])
    expect(r).toEqual({ ready: true, missing: [] })
  })

  it('treats an unknown required key as satisfied (no checker)', () => {
    expect(computeReadiness(good, ['some_future_field']).ready).toBe(true)
  })
})
