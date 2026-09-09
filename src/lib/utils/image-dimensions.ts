/**
 * Read pixel dimensions straight out of an image's header bytes.
 *
 * Runs in a Cloudflare Worker, where no native decoder is available: we parse the JPEG SOF
 * and PNG IHDR chunks by hand rather than decoding the image. Only the formats TikTok accepts
 * (see tiktok-image-policy) are supported; anything else returns null and the caller leaves the
 * image marked `unmeasured` rather than guessing.
 */

export interface ImageDimensions {
  width: number
  height: number
  format: 'jpeg' | 'png'
}

/** PNG: 8-byte signature, then a length + "IHDR" chunk whose first 8 bytes are width/height. */
function readPng(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!sig.every((v, i) => b[i] === v)) return null
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), format: 'png' }
}

/**
 * JPEG: walk the marker chain to the first Start Of Frame.
 * SOF0-SOF15 (0xC0-0xCF) carry the size, except DHT (0xC4), JPG (0xC8) and DAC (0xCC),
 * which are not frame headers and must be skipped like any other segment.
 */
function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }          // resync on padding bytes
    const marker = b[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (marker === 0xda || marker === 0xd9) return null   // start of scan: no SOF found
    const length = view.getUint16(i + 2)
    if (length < 2) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (i + 9 >= b.length) return null
      return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), format: 'jpeg' }
    }
    i += 2 + length
  }
  return null
}

/** Dimensions from header bytes, or null when the format is unsupported or the header is truncated. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return readPng(bytes) ?? readJpeg(bytes)
}
