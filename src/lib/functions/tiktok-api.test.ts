import { describe, it, expect } from 'vitest'
import { buildSignBase, pickShop, isReadOnlyTiktokCall } from './tiktok-api'

describe('buildSignBase', () => {
  it('sorts params, excludes sign & access_token, wraps in app_secret', () => {
    const base = buildSignBase(
      '/authorization/202309/shops',
      { timestamp: '100', app_key: 'KEY', sign: 'IGNORE', access_token: 'IGNORE' },
      '',
      'SECRET',
    )
    // sorted keys: app_key, timestamp (sign/access_token excluded)
    expect(base).toBe('SECRET/authorization/202309/shopsapp_keyKEYtimestamp100SECRET')
  })

  it('appends the JSON body when present', () => {
    const base = buildSignBase('/x', { app_key: 'K', timestamp: '1' }, '{"a":1}', 'S')
    expect(base).toBe('S/xapp_keyKtimestamp1{"a":1}S')
  })

  it('keeps a shop_cipher param in the signed base, in sorted order', () => {
    const base = buildSignBase('/product/202309/categories', { shop_cipher: 'C', app_key: 'K', timestamp: '9' }, '', 'S')
    // sorted: app_key, shop_cipher, timestamp
    expect(base).toBe('S/product/202309/categoriesapp_keyKshop_cipherCtimestamp9S')
  })

  it('excludes the body from the base for multipart uploads (signed with an empty body)', () => {
    // tiktokUpload signs with bodyStr = '' — the multipart payload is never part of the base.
    const base = buildSignBase('/product/202309/images/upload', { app_key: 'K', timestamp: '1' }, '', 'S')
    expect(base).toBe('S/product/202309/images/uploadapp_keyKtimestamp1S')
    // …and it must differ from what a JSON call with the same params would sign.
    expect(base).not.toBe(buildSignBase('/product/202309/images/upload', { app_key: 'K', timestamp: '1' }, '{"a":1}', 'S'))
  })
})

describe('pickShop', () => {
  const shops = [
    { id: '1', region: 'ES', cipher: 'C_ES' },
    { id: '2', region: 'IT', cipher: 'C_IT' },
    { id: '3', region: 'FR', cipher: 'C_FR' },
    { id: '4', region: 'IE', cipher: 'C_IE' },
  ]

  it('picks the shop of the requested region, not the first one', () => {
    expect(pickShop(shops, 'IE').cipher).toBe('C_IE')
    expect(pickShop(shops, 'fr').cipher).toBe('C_FR')
  })

  it('throws instead of falling back when the region is not authorized', () => {
    expect(() => pickShop(shops, 'DE')).toThrow(/region DE.*ES, IT, FR, IE/)
  })

  it('ignores a shop without cipher', () => {
    expect(() => pickShop([{ id: '9', region: 'IE' }], 'IE')).toThrow(/region IE/)
  })
})

describe('isReadOnlyTiktokCall', () => {
  it('allows GET and POST search endpoints only', () => {
    expect(isReadOnlyTiktokCall('/product/202309/products/123')).toBe(true)
    expect(isReadOnlyTiktokCall('/product/202309/products/search', 'POST')).toBe(true)
    expect(isReadOnlyTiktokCall('/order/202309/orders/search', 'post')).toBe(true)
    expect(isReadOnlyTiktokCall('/product/202309/products/123/prices/update', 'POST')).toBe(false)
    expect(isReadOnlyTiktokCall('/product/202309/products/123', 'PUT')).toBe(false)
    expect(isReadOnlyTiktokCall('/product/202309/products/123/partial_edit', 'POST')).toBe(false)
  })
})
