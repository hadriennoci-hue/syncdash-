import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { fillMissingFields } from '@/lib/functions/fill-missing'

const schema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const result = await fillMissingFields(params.sku, parsed.data.triggeredBy)
    return apiResponse(result)
  } catch (err) {
    return apiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error', 500)
  }
}
