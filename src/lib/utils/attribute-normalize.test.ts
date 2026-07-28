import { describe, it, expect } from 'vitest'
import {
  cleanAttributeValue,
  splitAttributeValues,
  normalizeAttributeValues,
  shortAttributeValue,
} from './attribute-normalize'

describe('cleanAttributeValue', () => {
  it('drops the "Up to" prefix but keeps the number', () => {
    expect(cleanAttributeValue('Up to 16,000 DPI')).toBe('16,000 DPI')
  })
  it('strips trademark symbols', () => {
    expect(cleanAttributeValue('16.8M RGB Lighting™')).toBe('16.8M RGB Lighting')
  })
  it('collapses whitespace incl. non-breaking spaces and trailing period', () => {
    expect(cleanAttributeValue('  Wi-Fi 6E .')).toBe('Wi-Fi 6E')
  })
})

describe('splitAttributeValues', () => {
  it('splits on pipes', () => {
    expect(splitAttributeValues('HDMI | DisplayPort | VGA')).toEqual(['HDMI', 'DisplayPort', 'VGA'])
  })
  it('does NOT split a thousands separator', () => {
    expect(splitAttributeValues('16,000 DPI')).toEqual(['16,000 DPI'])
  })
  it('splits a comma-separated list (comma not followed by a digit)', () => {
    expect(splitAttributeValues('HDMI, DisplayPort')).toEqual(['HDMI', 'DisplayPort'])
  })
  it('handles mixed number and pipe lists', () => {
    expect(splitAttributeValues('iPhone 15 series | Android 9.0+')).toEqual([
      'iPhone 15 series',
      'Android 9.0+',
    ])
  })
})

describe('normalizeAttributeValues', () => {
  it('de-dupes case-insensitively', () => {
    expect(normalizeAttributeValues('RGB | rgb')).toEqual(['RGB'])
  })
  it('cleans each value', () => {
    expect(normalizeAttributeValues('Laptop compartment | Multiple compartments')).toEqual([
      'Laptop compartment',
      'Multiple compartments',
    ])
  })
})

describe('shortAttributeValue', () => {
  it('shortens a known laptop GPU via the short map', () => {
    expect(shortAttributeValue('GeForce RTX 4050', { collection: 'laptops', key: 'gpu' })).toBe('RTX 4050')
  })
  it('falls back to cleaned value for categories without a short map', () => {
    expect(shortAttributeValue('6 programmable buttons', { collection: 'mice', key: 'buttons' })).toBe(
      '6 programmable buttons',
    )
  })
})
