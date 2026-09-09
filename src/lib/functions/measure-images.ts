/**
 * Fill in the pixel dimensions of a product's images, then re-run the TikTok rating.
 *
 * Image width/height are not captured at upload time, so every image starts life `unmeasured`
 * and the readiness gate can never confirm it. This fetches each image once, reads the size out
 * of the header bytes, persists it, and re-rates the product.
 *
 * R2 serves our images only to a browser-looking request — hence the UA and Referer below.
 */
import { db } from '@/lib/db/client'
import { productImages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { readImageDimensions } from '@/lib/utils/image-dimensions'
import { rateProductImages, type ImageDeep, type ProductImageRollup } from './tiktok-image-rating'

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Referer: 'https://wizhard.store/',
}

export interface MeasureResult {
  rollup: ProductImageRollup
  measured: number
  failed: Array<{ id: string; url: string; reason: string }>
}

/** Measure every image of `sku`, persist the sizes, and return the refreshed rating rollup. */
export async function measureProductImages(sku: string): Promise<MeasureResult> {
  const rows = await db.query.productImages.findMany({ where: eq(productImages.productId, sku) })

  const deep = new Map<string, ImageDeep>()
  const failed: MeasureResult['failed'] = []
  let measured = 0

  for (const row of rows) {
    try {
      const res = await fetch(row.url, { headers: FETCH_HEADERS })
      if (!res.ok) {
        failed.push({ id: row.id, url: row.url, reason: `HTTP ${res.status}` })
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      deep.set(row.id, { bytes: bytes.byteLength })

      const dim = readImageDimensions(bytes)
      if (!dim) {
        failed.push({ id: row.id, url: row.url, reason: 'unsupported or truncated header' })
        continue
      }
      await db.update(productImages)
        .set({ width: dim.width, height: dim.height })
        .where(eq(productImages.id, row.id))
      measured++
    } catch (err) {
      failed.push({ id: row.id, url: row.url, reason: err instanceof Error ? err.message : 'fetch failed' })
    }
  }

  return { rollup: await rateProductImages(sku, deep), measured, failed }
}
