import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { syncChannelAvailability } from '@/lib/functions/channel-sync'
import type { Platform } from '@/types/platform'

export const runtime = 'edge'

const schema = z.object({
  platforms:   z.array(z.string()).min(1).default(['shopify_komputerzz', 'woocommerce']),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await syncChannelAvailability(
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )

  return apiResponse(results)
}
