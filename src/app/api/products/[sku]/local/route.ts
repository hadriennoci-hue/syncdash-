import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { updateProductLocal } from '@/lib/functions/products'

const tagSchema = z.string().trim().min(1).max(40).regex(/^\S+$/, 'Tags must be single words')

const patchSchema = z.object({
  fields: z.object({
    title:       z.string().optional(),
    description: z.string().optional(),
    metaDescription: z.string().optional(),
    tags:        z.array(tagSchema).max(10).optional(),
    status:      z.enum(['active', 'archived']).optional(),
    pendingReview: z.boolean().optional(),
    isFeatured:  z.boolean().optional(),
    categoryIds: z.array(z.string()).optional(),
    collections: z.array(z.string()).optional(),
  }),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// PATCH — update D1 only (no platform push)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await updateProductLocal(params.sku, {
    fields:      {
      ...parsed.data.fields,
      categoryIds: parsed.data.fields.categoryIds ?? parsed.data.fields.collections,
    },
    triggeredBy: parsed.data.triggeredBy,
  })

  return apiResponse({ sku: params.sku })
}
