import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { toggleProductStatus } from '@/lib/functions/products'
import type { Platform } from '@/types/platform'


const patchSchema = z.object({
  status:      z.enum(['active', 'archived']),
  platforms:   z.array(z.string()).min(1).optional(),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// PATCH — toggle product status (active/archived)
export async function PATCH(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await toggleProductStatus(
    params.sku,
    parsed.data.status,
    (parsed.data.platforms ?? []) as Platform[],
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}
