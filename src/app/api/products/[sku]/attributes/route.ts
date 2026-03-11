import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getProductAttributes, setProductAttributes } from '@/lib/functions/product-attributes'

const attributeSchema = z.object({
  namespace: z.string().trim().min(1).max(60).optional(),
  key: z.string().trim().min(1).max(100),
  value: z.union([z.string(), z.null()]),
  type: z.union([z.string().trim().min(1).max(100), z.null()]).optional(),
})

const putSchema = z.object({
  mode: z.enum(['replace', 'merge']).default('merge'),
  attributes: z.array(attributeSchema).max(300),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function GET(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const attributes = await getProductAttributes(params.sku)
  return apiResponse(attributes)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    await setProductAttributes(params.sku, {
      mode: parsed.data.mode,
      attributes: parsed.data.attributes,
      triggeredBy: parsed.data.triggeredBy,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update attributes'
    if (message.includes('not found')) return apiError('NOT_FOUND', message, 404)
    return apiError('INTERNAL_ERROR', message, 500)
  }

  const attributes = await getProductAttributes(params.sku)
  return apiResponse({ sku: params.sku, attributes })
}
