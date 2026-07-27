/**
 * TikTok image compliance rating (see docs/tiktok-readiness-spec.md §5b).
 *
 * `rateImageMeta` is a pure function over image metadata — the cheap checks that need no
 * network (dimensions, aspect ratio, format from URL). The pixel-dependent checks
 * (opaque-white main background, greyscale, byte size) are layered on later via an optional
 * `deep` input once we fetch bytes; the shape is ready for them.
 *
 * `rateProductImages` persists the result to product_images and returns a product-level rollup
 * used by the TikTok readiness gate.
 */
import { db } from '@/lib/db/client'
import { productImages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  TIKTOK_IMAGE_POLICY as P,
  TIKTOK_IMAGE_FAIL_ISSUES,
  type TiktokImageStatus,
  type TiktokImageIssue,
} from '@/lib/constants/tiktok-image-policy'

export interface ImageMeta {
  url: string
  position: number
  width: number | null
  height: number | null
}

/** Optional pixel-derived signals (from a fetched image); all checks are skipped when absent. */
export interface ImageDeep {
  bytes?: number
  /** true if the 4 corners are opaque near-white (main image requirement). */
  cornersWhite?: boolean
  /** true if the image is effectively greyscale. */
  greyscale?: boolean
}

export interface ImageRating {
  status: TiktokImageStatus
  issues: TiktokImageIssue[]
}

function formatFromUrl(url: string): string | null {
  const m = url.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)
  return m ? m[1] : null
}

/** Rate a single image from metadata (+ optional pixel signals). Pure, deterministic. */
export function rateImageMeta(meta: ImageMeta, deep?: ImageDeep): ImageRating {
  const issues: TiktokImageIssue[] = []
  const isMain = meta.position === P.mainPosition

  // format
  const ext = formatFromUrl(meta.url)
  if (!ext || !(P.formats as readonly string[]).includes(ext)) issues.push('format')

  // dimensions + ratio
  if (meta.width == null || meta.height == null || meta.width <= 0 || meta.height <= 0) {
    issues.push('unmeasured')
  } else {
    const minEdge = Math.min(meta.width, meta.height)
    if (minEdge < P.minPx) issues.push('min_px')
    else if (minEdge < P.targetPx) issues.push('below_target')

    const ratio = meta.width / meta.height
    if (Math.abs(ratio - P.aspectRatio) > P.aspectTolerance) issues.push('ratio')
  }

  // pixel-dependent checks (only when we have the signals)
  if (deep) {
    if (deep.bytes != null && deep.bytes > P.maxBytes) issues.push('too_large')
    if (deep.greyscale) issues.push('greyscale')
    if (isMain && deep.cornersWhite === false) issues.push('main_bg')
  }

  const hasFail = issues.some((i) => TIKTOK_IMAGE_FAIL_ISSUES.has(i))
  const status: TiktokImageStatus = hasFail ? 'fail' : issues.length ? 'warn' : 'pass'
  return { status, issues }
}

export interface ProductImageRollup {
  sku: string
  total: number
  passCount: number
  mainOk: boolean          // position-0 image exists and passes
  /** provisional: pixel checks (white bg) land later — see spec §5b */
  readyForTiktok: boolean  // >= minCountGood passing AND main passes
  images: Array<{ id: string; position: number } & ImageRating>
}

/** Rate all images of a product, persist the result, and return the rollup. */
export async function rateProductImages(sku: string): Promise<ProductImageRollup> {
  const rows = await db.query.productImages.findMany({
    where: eq(productImages.productId, sku),
  })

  const now = new Date().toISOString()
  const rated = rows.map((r) => {
    const rating = rateImageMeta({
      url: r.url,
      position: r.position ?? 0,
      width: r.width ?? null,
      height: r.height ?? null,
    })
    return { id: r.id, position: r.position ?? 0, ...rating }
  })

  await Promise.all(
    rated.map((r) =>
      db
        .update(productImages)
        .set({ tiktokStatus: r.status, tiktokIssues: JSON.stringify(r.issues), ratedAt: now })
        .where(eq(productImages.id, r.id)),
    ),
  )

  const passCount = rated.filter((r) => r.status === 'pass').length
  const main = rated.find((r) => r.position === P.mainPosition)
  const mainOk = !!main && main.status === 'pass'

  return {
    sku,
    total: rated.length,
    passCount,
    mainOk,
    readyForTiktok: passCount >= P.minCountGood && mainOk,
    images: rated,
  }
}
