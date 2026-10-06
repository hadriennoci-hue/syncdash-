import { describe, expect, it } from 'vitest'
import { EXTERNALLY_STOCKED_PLATFORMS } from './stock-ownership'

describe('EXTERNALLY_STOCKED_PLATFORMS', () => {
  it('leaves the TikTok Tech Store stock to Mintsoft', () => {
    expect(EXTERNALLY_STOCKED_PLATFORMS.has('shopify_tiktok')).toBe(true)
  })

  it('keeps Wizhard in charge of Komputerzz and Coincart stock', () => {
    expect(EXTERNALLY_STOCKED_PLATFORMS.has('shopify_komputerzz')).toBe(false)
    expect(EXTERNALLY_STOCKED_PLATFORMS.has('coincart2')).toBe(false)
  })
})
