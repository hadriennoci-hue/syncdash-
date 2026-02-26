import { db } from '@/lib/db/client'
import { productImages, platformMappings } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { getR2Bucket, getR2PublicUrl, r2KeyFromUrl } from '@/lib/r2/client'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { Platform, SyncResult, TriggeredBy, ImageInput } from '@/types/platform'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface UploadFile {
  buffer: ArrayBuffer
  filename: string
  mimeType: string
  alt?: string
}

async function deleteR2Keys(urls: string[]): Promise<void> {
  if (urls.length === 0) return
  let publicUrl: string
  try { publicUrl = getR2PublicUrl() } catch { return } // R2 not configured — skip
  const keys = urls
    .filter(u => u.startsWith(publicUrl + '/'))
    .map(u => r2KeyFromUrl(u, publicUrl))
  if (keys.length === 0) return
  const bucket = getR2Bucket()
  await Promise.all(keys.map(k => bucket.delete(k)))
}

// ---------------------------------------------------------------------------
// setProductImages — replaces all images
// ---------------------------------------------------------------------------

export async function setProductImages(
  sku: string,
  images: ImageInput[],
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  // Update D1
  await db.delete(productImages).where(eq(productImages.productId, sku))
  for (const [i, img] of images.entries()) {
    if (img.type === 'url') {
      await db.insert(productImages).values({
        id:        generateId(),
        productId: sku,
        url:       img.url,
        position:  i,
        alt:       img.alt ?? null,
      })
    }
  }

  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connector = await createConnector(platform)
      await connector.setImages(mapping.platformId, images)
      await logOperation({ productId: sku, platform, action: 'set_images', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'set_images', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// addProductImages — appends without touching existing
// ---------------------------------------------------------------------------

export async function addProductImages(
  sku: string,
  images: ImageInput[],
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  const existing = await db.query.productImages.findMany({
    where: eq(productImages.productId, sku),
    orderBy: (t, { desc }) => [desc(t.position)],
  })
  const nextPosition = (existing[0]?.position ?? -1) + 1

  for (const [i, img] of images.entries()) {
    if (img.type === 'url') {
      await db.insert(productImages).values({
        id:        generateId(),
        productId: sku,
        url:       img.url,
        position:  nextPosition + i,
        alt:       img.alt ?? null,
      })
    }
  }

  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connector = await createConnector(platform)
      await connector.addImages(mapping.platformId, images)
      await logOperation({ productId: sku, platform, action: 'add_images', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'add_images', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// deleteProductImages
// ---------------------------------------------------------------------------

export async function deleteProductImages(
  sku: string,
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  // Fetch before deleting so we can clean up R2-hosted images
  const existing = await db.query.productImages.findMany({
    where: eq(productImages.productId, sku),
  })
  await deleteR2Keys(existing.map(img => img.url))
  await db.delete(productImages).where(eq(productImages.productId, sku))

  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connector = await createConnector(platform)
      await connector.deleteImages(mapping.platformId)
      await logOperation({ productId: sku, platform, action: 'delete_images', status: 'success', triggeredBy })
      results.push({ platform, success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'delete_images', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// copyImagesBetweenPlatforms
// ---------------------------------------------------------------------------

export async function copyImagesBetweenPlatforms(
  sku: string,
  sourcePlatform: Platform,
  targetPlatforms: Platform[],
  mode: 'replace' | 'add',
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  // Get images from D1 (imported from source platform)
  const d1Images = await db.query.productImages.findMany({
    where: eq(productImages.productId, sku),
    orderBy: (t, { asc }) => [asc(t.position)],
  })

  if (d1Images.length === 0) {
    return targetPlatforms.map((platform) => ({
      platform,
      success: false,
      error: 'No images found in D1 for this product',
    }))
  }

  const imageInputs: ImageInput[] = d1Images.map((img) => ({
    type: 'url' as const,
    url:  img.url,
    alt:  img.alt ?? undefined,
  }))

  const fn = mode === 'replace' ? setProductImages : addProductImages
  return fn(sku, imageInputs, targetPlatforms, triggeredBy)
}

// ---------------------------------------------------------------------------
// uploadProductImages — upload files to R2, save URLs to D1
// ---------------------------------------------------------------------------

export async function uploadProductImages(
  sku: string,
  files: UploadFile[],
  mode: 'replace' | 'add',
  triggeredBy: TriggeredBy = 'human'
): Promise<{ urls: string[]; errors: string[] }> {
  const bucket = getR2Bucket()
  const publicUrl = getR2PublicUrl()

  if (mode === 'replace') {
    const existing = await db.query.productImages.findMany({
      where: eq(productImages.productId, sku),
    })
    await deleteR2Keys(existing.map(img => img.url))
    await db.delete(productImages).where(eq(productImages.productId, sku))
  }

  const existingForPosition = mode === 'add'
    ? await db.query.productImages.findMany({
        where: eq(productImages.productId, sku),
        orderBy: (t, { desc }) => [desc(t.position)],
      })
    : []
  const startPosition = mode === 'add' ? (existingForPosition[0]?.position ?? -1) + 1 : 0

  const urls: string[] = []
  const errors: string[] = []

  for (const [i, file] of files.entries()) {
    const ext = file.filename.split('.').pop() ?? 'jpg'
    const key = `products/${sku}/${generateId()}.${ext}`
    try {
      await bucket.put(key, file.buffer, { httpMetadata: { contentType: file.mimeType } })
      const url = `${publicUrl}/${key}`
      await db.insert(productImages).values({
        id:        generateId(),
        productId: sku,
        url,
        position:  startPosition + i,
        alt:       file.alt ?? null,
      })
      urls.push(url)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Failed to upload ${file.filename}`)
    }
  }

  const status = errors.length === 0 ? 'success' : errors.length < files.length ? 'error' : 'error'
  await logOperation({ productId: sku, action: 'upload_images', status, triggeredBy,
    message: errors.length > 0 ? errors.join('; ') : undefined })

  return { urls, errors }
}
