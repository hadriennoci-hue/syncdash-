import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { autoLinkVariantFamily } from '@/lib/functions/variant-family'

const schema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const result = await autoLinkVariantFamily(params.sku, parsed.data.triggeredBy)
    return apiResponse({ sku: params.sku, ...result })
  } catch (error) {
    return apiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
