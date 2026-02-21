import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { importFromPlatform } from '@/lib/functions/import'
import { PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'

export const runtime = 'edge'

const postSchema = z.object({
  mode:        z.enum(['full', 'incremental']).default('incremental'),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// POST — trigger import from a platform into D1
export async function POST(req: NextRequest, { params }: { params: { platform: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  if (!PLATFORMS.includes(params.platform as Platform)) {
    return apiError('NOT_FOUND', `Unknown platform: ${params.platform}`, 404)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const result = await importFromPlatform(
    params.platform as Platform,
    parsed.data.mode,
    parsed.data.triggeredBy
  )
  return apiResponse(result)
}
