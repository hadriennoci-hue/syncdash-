import { describe, it, expect } from 'vitest'
import { buildSignBase } from './tiktok-api'

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
})
