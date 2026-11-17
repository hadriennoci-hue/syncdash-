import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { refreshListings, isTiktokRegion, TIKTOK_REGIONS, type TiktokRegion } from '@/lib/functions/tiktok-listings'

const schema = z.object({ regions: z.array(z.string()).optional() })

/** POST /api/tiktok/listings/refresh — read every TikTok shop and record live prices/statuses in D1. */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  const regions = (parsed.data.regions ?? [...TIKTOK_REGIONS]).map((r) => r.toUpperCase())
  const bad = regions.filter((r) => !isTiktokRegion(r))
  if (bad.length) return apiError('VALIDATION_ERROR', `Unknown TikTok shop region(s): ${bad.join(', ')}`, 400)
  return apiResponse({ results: await refreshListings(regions as TiktokRegion[]) })
}
