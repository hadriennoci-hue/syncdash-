import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products, productImages, warehouseStock } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'
import { logOperation } from '@/lib/functions/log'

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
    return apiError('ACER_RUNNER_REQUIRED', 'ACER products must use the local Playwright acer-fill runner for descriptions, attributes, collections, and images.', 400)
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
