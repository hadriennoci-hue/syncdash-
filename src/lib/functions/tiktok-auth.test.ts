import { describe, it, expect } from 'vitest'
import { buildTokenGetUrl, parseTokenResponse, stateMatches } from './tiktok-auth'

describe('buildTokenGetUrl', () => {
  it('builds the v2 token/get URL with authorized_code grant', () => {
    const url = buildTokenGetUrl('AUTH123', 'KEY', 'SECRET')
    expect(url).toContain('https://auth.tiktok-shops.com/api/v2/token/get?')
    expect(url).toContain('app_key=KEY')
    expect(url).toContain('app_secret=SECRET')
    expect(url).toContain('auth_code=AUTH123')
    expect(url).toContain('grant_type=authorized_code')
  })
})

describe('parseTokenResponse', () => {
  it('parses a success response and derives ISO expiry from unix seconds', () => {
    const expireUnix = 1893456000 // 2030-01-01T00:00:00Z
    const { data, expiresAtIso } = parseTokenResponse({
      code: 0,
      message: 'success',
      data: { access_token: 'AT', refresh_token: 'RT', access_token_expire_in: expireUnix, refresh_token_expire_in: expireUnix, seller_name: 'Tech Store' },
    })
    expect(data.access_token).toBe('AT')
    expect(expiresAtIso).toBe(new Date(expireUnix * 1000).toISOString())
  })

  it('throws on a non-zero API code', () => {
    expect(() => parseTokenResponse({ code: 36004003, message: 'invalid auth_code', data: {} })).toThrow(/TikTok token error/)
  })

  it('throws when access_token is missing', () => {
    expect(() => parseTokenResponse({ code: 0, message: 'ok', data: {} })).toThrow()
  })
})

describe('stateMatches', () => {
  it('is disabled (passes) when no expected state configured', () => {
    expect(stateMatches(null, undefined)).toBe(true)
    expect(stateMatches('anything', undefined)).toBe(true)
  })
  it('matches an equal state and rejects a wrong or missing one', () => {
    expect(stateMatches('abc123', 'abc123')).toBe(true)
    expect(stateMatches('abc124', 'abc123')).toBe(false)
    expect(stateMatches(null, 'abc123')).toBe(false)
    expect(stateMatches('abc', 'abc123')).toBe(false)
  })
})
