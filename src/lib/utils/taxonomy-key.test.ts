import { describe, it, expect } from 'vitest'
import { slugifyCollection, deriveTaxonomyKey } from './taxonomy-key'

const VALID = new Set([
  'mice', 'headsets_earbuds', 'laptop_bags', 'docking_stations', 'controllers',
  'connectivity', 'laptops', 'gaming_laptops', 'monitors', 'ultrawide_monitors',
])

describe('slugifyCollection', () => {
  it('collapses & and spaces to underscores', () => {
    expect(slugifyCollection('Headsets & Earbuds')).toBe('headsets_earbuds')
    expect(slugifyCollection('Ultrawide Monitors')).toBe('ultrawide_monitors')
    expect(slugifyCollection('Mice')).toBe('mice')
  })
})

describe('deriveTaxonomyKey', () => {
  it('returns the first collection that maps to a known key', () => {
    expect(deriveTaxonomyKey(['Mice'], VALID)).toBe('mice')
    expect(deriveTaxonomyKey(['Headsets & Earbuds', 'Audio'], VALID)).toBe('headsets_earbuds')
  })

  it('skips collections with no mapping', () => {
    expect(deriveTaxonomyKey(['Featured', 'New Arrivals', 'Docking Stations'], VALID)).toBe('docking_stations')
  })

  it('ignores null/empty names', () => {
    expect(deriveTaxonomyKey([null, '', 'Controllers'], VALID)).toBe('controllers')
  })

  it('returns null when nothing maps', () => {
    expect(deriveTaxonomyKey(['Sale', 'Bundles'], VALID)).toBeNull()
  })
})
