import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { assignCategories } from '@/lib/functions/categories'
import type { Platform } from '@/types/platform'


const putSchema = z.object({
  categoryIds: z.array(z.string()),
  platforms:   z.array(z.string()).min(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// PUT — replace all categories for a product
export async function PUT(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await assignCategories(
    params.sku,
    parsed.data.categoryIds,
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}
