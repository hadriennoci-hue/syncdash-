import { describe, it, expect } from 'vitest'
import { applyCatalogueFields } from './products'

describe('applyCatalogueFields', () => {
  it('maps package dimensions onto the D1 update object', () => {
    const out = applyCatalogueFields({
      packageLengthMm: 150, packageWidthMm: 105, packageHeightMm: 70, packageWeightG: 200,
    })
    expect(out).toEqual({
      packageLengthMm: 150, packageWidthMm: 105, packageHeightMm: 70, packageWeightG: 200,
    })
  })

  it('leaves absent fields out entirely, so a partial update never nulls a column', () => {
    expect(applyCatalogueFields({ ean: '4711474858887' })).toEqual({ ean: '4711474858887' })
  })

  it('serialises boxContents to a JSON array string', () => {
    expect(applyCatalogueFields({ boxContents: ['Soundbar', 'USB-C cable'] }).boxContents)
      .toBe('["Soundbar","USB-C cable"]')
  })

  it('merges into an existing target without dropping its keys', () => {
    const target: Record<string, unknown> = { updatedAt: 'now' }
    applyCatalogueFields({ countryOfManufacture: 'CN', weight: 0.2, weightUnit: 'kg' }, target)
    expect(target).toEqual({ updatedAt: 'now', countryOfManufacture: 'CN', weight: 0.2, weightUnit: 'kg' })
  })

  it('keeps a zero warranty rather than treating it as absent', () => {
    expect(applyCatalogueFields({ warrantyMonths: 0 })).toEqual({ warrantyMonths: 0 })
  })
})
