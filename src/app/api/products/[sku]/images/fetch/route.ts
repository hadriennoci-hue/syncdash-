import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productImages, warehouseStock } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { logOperation } from '@/lib/functions/log'
import FirecrawlApp from '@mendable/firecrawl-js'

const schema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
  maxImages:   z.number().int().min(1).max(20).default(5),
})

// ---------------------------------------------------------------------------
// Shopify — fetch product images by variant SKU
// ---------------------------------------------------------------------------

async function fetchShopifyImages(sku: string): Promise<{ url: string; alt: string | null }[]> {
  const shop  = process.env.SHOPIFY_TIKTOK_SHOP
  const token = process.env.SHOPIFY_TIKTOK_TOKEN
  if (!shop || !token) throw new Error('Shopify TikTok env vars not set')

  const res = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `
        query ($sku: String!) {
          productVariants(first: 1, query: $sku) {
            nodes {
              product {
                images(first: 20) {
                  nodes { url altText }
                }
              }
            }
          }
        }
      `,
      variables: { sku: `sku:${sku}` },
    }),
  })

  if (!res.ok) throw new Error(`Shopify error: ${res.status}`)
  const json = await res.json() as { data?: { productVariants?: { nodes?: { product?: { images?: { nodes?: { url: string; altText?: string }[] } } }[] } } }
  const nodes = json.data?.productVariants?.nodes?.[0]?.product?.images?.nodes ?? []
  return nodes.map((n) => ({ url: n.url, alt: n.altText ?? null }))
}

// ---------------------------------------------------------------------------
// Firecrawl — extract product images from a page URL
// ---------------------------------------------------------------------------

// Parse the `height` query param value from a CDN URL (returns 0 if absent).
function parseCdnHeight(url: string): number {
  try {
    const h = new URL(url).searchParams.get('height')
    return h ? parseInt(h, 10) : 0
  } catch { return 0 }
}

// Deduplicate images by their base path (before `?`).
// When the same physical image appears at multiple resolutions, keep the largest.
function deduplicateByBasePath(
  images: { url: string; alt: string | null }[]
): { url: string; alt: string | null }[] {
  const best = new Map<string, { url: string; alt: string | null; height: number }>()
  for (const img of images) {
    const base   = img.url.split('?')[0]
    const height = parseCdnHeight(img.url)
    const prev   = best.get(base)
    if (!prev || height > prev.height) best.set(base, { ...img, height })
  }
  return [...best.values()].map(({ url, alt }) => ({ url, alt }))
}

async function fetchFirecrawlImages(sourceUrl: string): Promise<{ url: string; alt: string | null }[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set')

  const app = new FirecrawlApp({ apiKey })
  const result = await app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    waitFor: 3000,
    extract: {
      prompt:
        'This is an ACER Store product page. The product has a main image and a gallery showing multiple angles. ' +
        'When you click the main image it opens a full-screen slideshow with all images in high definition. ' +
        'Extract ONLY the high-definition/full-size image URLs from that slideshow or gallery — ' +
        'these are the large versions (typically 400px or larger in both dimensions). ' +
        'Do NOT return thumbnail images (small preview images, usually under 200px). ' +
        'For each unique product angle, return only the largest available version of the URL. ' +
        'Return every distinct product angle: front, side, back, detail shots, etc.',
      schema: {
        type:       'object',
        properties: { images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, required: ['url'] } } },
        required:   ['images'],
      },
    },
  })

  if (!result.success) throw new Error(`Firecrawl scrape failed: ${(result as { error?: string }).error ?? 'unknown'}`)
  const extracted = (result as { extract?: { images?: { url: string; alt?: string }[] } }).extract
  const raw = (extracted?.images ?? []).map((img) => ({ url: img.url, alt: img.alt ?? null }))

  // Deduplicate: one URL per unique image path, keeping largest resolution
  const deduped = deduplicateByBasePath(raw)

  // Drop anything still below 200px — true thumbnails that Firecrawl scraped
  // despite the prompt instruction. Upgrade ACER CDN thumbnails to 500px if possible.
  return deduped.map((img) => {
    const h = parseCdnHeight(img.url)
    if (h > 0 && h < 200) {
      // ACER CDN is parametric — replace size params to get the 500px version
      const upgraded = img.url
        .replace(/height=\d+/, 'height=500')
        .replace(/width=\d+/, 'width=500')
        .replace(/canvas=\d+:\d+/, 'canvas=500:500')
      return { ...img, url: upgraded }
    }
    return img
  })
}

// ---------------------------------------------------------------------------
// POST /api/products/[sku]/images/fetch
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const { triggeredBy, maxImages } = parsed.data
  const sku = params.sku

  const product = await db.query.products.findFirst({ where: eq(products.id, sku) })
  if (!product) return apiError('NOT_FOUND', `Product ${sku} not found`, 404)

  // Determine fetch strategy from warehouse_stock source info
  const stocks = await db.query.warehouseStock.findMany({ where: eq(warehouseStock.productId, sku) })
  const acerRow    = stocks.find((s) => s.warehouseId === 'acer_store' && s.sourceUrl && s.sourceUrl !== 'null')
  const irelandRow = stocks.find((s) => s.warehouseId === 'ireland')

  let rawImages: { url: string; alt: string | null }[] = []
  let source = ''

  if (acerRow?.sourceUrl) {
    source = `acer_store:${acerRow.sourceUrl}`
    rawImages = await fetchFirecrawlImages(acerRow.sourceUrl)
  } else if (irelandRow) {
    source = 'shopify_tiktok'
    rawImages = await fetchShopifyImages(sku)
  } else {
    return apiError('NOT_FOUND', 'No known image source for this product', 404)
  }

  if (rawImages.length === 0) {
    return apiError('NOT_FOUND', `No images found from source: ${source}`, 404)
  }

  const toInsert = rawImages.slice(0, maxImages)

  // Replace existing images in D1
  await db.delete(productImages).where(eq(productImages.productId, sku))
  for (const [i, img] of toInsert.entries()) {
    await db.insert(productImages).values({
      id:        generateId(),
      productId: sku,
      url:       img.url,
      alt:       img.alt,
      position:  i,
    })
  }

  await logOperation({
    productId: sku,
    action:    'fetch_images',
    status:    'success',
    message:   `Fetched ${toInsert.length} images from ${source}`,
    triggeredBy,
  })

  return apiResponse({ sku, source, imagesFetched: toInsert.length, images: toInsert })
}
