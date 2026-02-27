import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { deleteProductImageById } from '@/lib/functions/images'

const deleteSchema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// DELETE — remove a single image (D1 + R2)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { sku: string; imageId: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    const result = await deleteProductImageById(
      params.sku,
      params.imageId,
      parsed.data.triggeredBy
    )
    return apiResponse(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError('NOT_FOUND', message, 404)
  }
}
