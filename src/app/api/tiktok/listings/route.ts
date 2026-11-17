import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { listListings, setListing, isTiktokRegion } from '@/lib/functions/tiktok-listings'

/** GET /api/tiktok/listings — per product: wanted/live price and status on each TikTok shop (IE/FR/ES/IT). */
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  return apiResponse({ products: await listListings() })
}

const patchSchema = z.object({
  sku: z.string().min(1),
  region: z.string().transform((r) => r.toUpperCase()),
  price: z.number().positive().nullable().optional(),
  forSale: z.boolean().optional(),
})

/** PATCH /api/tiktok/listings — set the wanted price and/or for-sale flag of one product on one shop (D1 only). */
export async function PATCH(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  const { sku, region, price, forSale } = parsed.data
  if (!isTiktokRegion(region)) return apiError('VALIDATION_ERROR', `Unknown TikTok shop region ${region}`, 400)
  if (region === 'IE' && price !== undefined) {
    return apiError('VALIDATION_ERROR', 'The IE price is set in Shopify (shopify_tiktok price), not here', 400)
  }
  try {
    await setListing(sku, region, { price, forSale })
  } catch (err) {
    return apiError('DB_ERROR', err instanceof Error ? err.message : 'Unknown error', 400)
  }
  return apiResponse({ success: true })
}
