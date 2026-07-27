import { describe, it, expect } from 'vitest'
import { rateImageMeta } from './tiktok-image-rating'

describe('rateImageMeta', () => {
  it('passes a clean 1000x1000 jpg', () => {
    const r = rateImageMeta({ url: 'https://img/x/1.jpg', position: 0, width: 1000, height: 1000 })
    expect(r).toEqual({ status: 'pass', issues: [] })
  })

  it('warns when below target but above min', () => {
    const r = rateImageMeta({ url: 'https://img/x/2.jpg', position: 1, width: 850, height: 850 })
    expect(r.status).toBe('warn')
    expect(r.issues).toContain('below_target')
  })

  it('fails below the hard minimum edge', () => {
    const r = rateImageMeta({ url: 'https://img/x/3.jpg', position: 1, width: 640, height: 640 })
    expect(r.status).toBe('fail')
    expect(r.issues).toContain('min_px')
  })

  it('fails a non-square image', () => {
    const r = rateImageMeta({ url: 'https://img/x/4.jpg', position: 1, width: 1200, height: 900 })
    expect(r.status).toBe('fail')
    expect(r.issues).toContain('ratio')
  })

  it('fails an unsupported format', () => {
    const r = rateImageMeta({ url: 'https://img/x/5.webp', position: 1, width: 1000, height: 1000 })
    expect(r.status).toBe('fail')
    expect(r.issues).toContain('format')
  })

  it('warns (unmeasured) when dimensions are unknown', () => {
    const r = rateImageMeta({ url: 'https://img/x/6.jpg', position: 2, width: null, height: null })
    expect(r.status).toBe('warn')
    expect(r.issues).toContain('unmeasured')
  })

  it('tolerates query strings in the URL and near-square ratios', () => {
    const r = rateImageMeta({ url: 'https://img/x/7.png?width=1000', position: 1, width: 1000, height: 1010 })
    expect(r.status).toBe('pass')
  })

  it('fails main image with non-white corners via deep signal', () => {
    const r = rateImageMeta(
      { url: 'https://img/x/1.jpg', position: 0, width: 1000, height: 1000 },
      { cornersWhite: false },
    )
    expect(r.status).toBe('fail')
    expect(r.issues).toContain('main_bg')
  })
})
