import { describe, it, expect } from 'vitest'
import { readImageDimensions } from './image-dimensions'

/** Minimal PNG: signature + IHDR chunk carrying the size. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

/** Minimal JPEG: SOI, optional leading segments, then an SOF0 carrying height then width. */
function jpeg(w: number, h: number, lead: number[] = []): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03]
  return Uint8Array.from([0xff, 0xd8, ...lead, ...sof])
}

describe('readImageDimensions', () => {
  it('reads a PNG IHDR', () => {
    expect(readImageDimensions(png(1000, 1000))).toEqual({ width: 1000, height: 1000, format: 'png' })
  })

  it('reads a JPEG SOF0', () => {
    expect(readImageDimensions(jpeg(1803, 1200))).toEqual({ width: 1803, height: 1200, format: 'jpeg' })
  })

  it('skips a DHT segment rather than reading it as a frame header', () => {
    const dht = [0xff, 0xc4, 0x00, 0x06, 0x00, 0x01, 0x02, 0x03]
    expect(readImageDimensions(jpeg(800, 800, dht))?.width).toBe(800)
  })

  it('skips an APP0/JFIF segment', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x08, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x00]
    expect(readImageDimensions(jpeg(1000, 1000, app0))).toEqual({ width: 1000, height: 1000, format: 'jpeg' })
  })

  it('returns null on an unsupported format rather than guessing', () => {
    expect(readImageDimensions(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull()
  })

  it('returns null on a truncated header', () => {
    expect(readImageDimensions(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull()
  })

  it('returns null when the scan starts before any frame header', () => {
    expect(readImageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0, 0, 0, 0, 0, 0]))).toBeNull()
  })
})
