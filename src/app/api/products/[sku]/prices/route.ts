import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { updateProductPrice } from '@/lib/functions/prices'
import type { Platform } from '@/types/platform'


const patchSchema = z.object({
  price:       z.number().positive().optional(),
  compareAt:   z.number().positive().optional(),
  platforms:   z.array(z.string()).min(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// PATCH — update price (and optionally compareAt) on one or more platforms
export async function PATCH(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  if (parsed.data.price === undefined && parsed.data.compareAt === undefined) {
    return apiError('VALIDATION_ERROR', 'At least one of price or compareAt is required', 400)
  }

  const pricesMap: Partial<Record<Platform, number | null>> = {}
  const compareAtMap: Partial<Record<Platform, number | null>> = {}
  for (const p of parsed.data.platforms as Platform[]) {
    if (parsed.data.price     !== undefined) pricesMap[p]    = parsed.data.price
    if (parsed.data.compareAt !== undefined) compareAtMap[p] = parsed.data.compareAt
  }

  const results = await updateProductPrice(
    params.sku,
    pricesMap,
    compareAtMap,
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}
