import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { syncChannelAvailability } from '@/lib/functions/channel-sync'
import { requestRunnerWake } from '@/lib/functions/runner-signal'
import { db } from '@/lib/db/client'
import { salesChannels } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import type { Platform } from '@/types/platform'


const schema = z.object({
  platforms:   z.array(z.string()).min(1).default(['shopify_komputerzz', 'coincart2', 'libre_market', 'xmr_bazaar']),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
  protectRecentChannelEditsHours: z.number().min(0).max(24 * 30).default(0.5),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  // Wake local browser runner immediately when Push starts.
  // Runner itself processes only products currently marked 2push.
  await requestRunnerWake('browser', 'channel-availability push')
  const startedAt = new Date().toISOString()
  await db.update(salesChannels)
    .set({ lastPush: startedAt })
    .where(inArray(salesChannels.id, parsed.data.platforms as Platform[]))

  const results = await syncChannelAvailability(
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy,
    { protectRecentChannelEditsHours: parsed.data.protectRecentChannelEditsHours }
  )

  return apiResponse(results)
}

