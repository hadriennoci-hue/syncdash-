import { describe, expect, it } from 'vitest'
import { buildSnapshots, pickField, sellableQuantity } from './mintsoft'

describe('pickField', () => {
  it('matches field names case-insensitively', () => {
    expect(pickField({ ProductID: 7 }, 'ProductId')).toBe(7)
    expect(pickField({ sku: 'A' }, 'SKU')).toBe('A')
  })
})

describe('sellableQuantity', () => {
  it('prefers Available when present', () => {
    expect(sellableQuantity({ Level: 10, Allocated: 3, Available: 5 })).toBe(5)
  })
  it('falls back to Level minus Allocated, never below zero', () => {
    expect(sellableQuantity({ Level: 10, Allocated: 3 })).toBe(7)
    expect(sellableQuantity({ Level: 1, Allocated: 4 })).toBe(0)
  })
})

describe('buildSnapshots', () => {
  const products = [
    { ID: 1, SKU: 'GP.MCE11.03S', Name: 'Predator Cestus 333' },
    { ID: 2, SKU: 'GP.BAG11.07U', Name: 'Predator Utility Lite' },
  ]

  it('joins levels to SKUs and sums rows per SKU', () => {
    const levels = [
      { ProductId: 1, WarehouseId: 3, Level: 4, Allocated: 1 },
      { ProductId: 1, WarehouseId: 3, Level: 2, Allocated: 0 },
    ]
    const snaps = buildSnapshots(products, levels)
    expect(snaps.find((s) => s.sku === 'GP.MCE11.03S')?.quantity).toBe(5)
  })

  it('reports products without a level row at zero', () => {
    const snaps = buildSnapshots(products, [{ ProductId: 1, Level: 2 }])
    expect(snaps.find((s) => s.sku === 'GP.BAG11.07U')?.quantity).toBe(0)
  })

  it('keeps only the configured warehouse', () => {
    const levels = [
      { ProductId: 1, WarehouseId: 3, Level: 4 },
      { ProductId: 1, WarehouseId: 9, Level: 50 },
    ]
    expect(buildSnapshots(products, levels, 3).find((s) => s.sku === 'GP.MCE11.03S')?.quantity).toBe(4)
  })
})
