import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { copyImagesBetweenPlatforms } from '@/lib/functions/images'
import type { Platform } from '@/types/platform'


const copySchema = z.object({
  sourcePlatform:      z.string(),
  destinationPlatforms: z.array(z.string()).min(1),
  mode: z.enum(['replace', 'add']).default('replace'),
  triggeredBy:         z.enum(['human', 'agent']).default('human'),
})

// POST — copy images from one platform to others
export async function POST(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = copySchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await copyImagesBetweenPlatforms(
    params.sku,
    parsed.data.sourcePlatform as Platform,
    parsed.data.destinationPlatforms as Platform[],
    parsed.data.mode,
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}
