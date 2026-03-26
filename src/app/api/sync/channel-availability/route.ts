import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { syncChannelAvailability } from '@/lib/functions/channel-sync'
import { requestRunnerWake } from '@/lib/functions/runner-signal'
import { db } from '@/lib/db/client'
import { salesChannels } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { findUnsavedChannelRows } from '@/lib/functions/channel-unsaved'
import { ensureFreshShopifyToken } from '@/lib/functions/tokens'
import type { Platform } from '@/types/platform'


const schema = z.object({
  platforms:   z.array(z.string()).length(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
  protectRecentChannelEditsHours: z.number().min(0).max(24 * 30).default(0.5),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  const platforms = parsed.data.platforms as Platform[]

  for (const platform of platforms) {
    const issues = await findUnsavedChannelRows(platform)
    if (issues.length > 0) {
      return apiError(
        'VALIDATION_ERROR',
        `${platform} sale channel needs to be saved first (${issues.length} unsaved row(s), first SKU: ${issues[0].sku})`,
        400
      )
    }
  }

  if (platforms.includes('shopify_komputerzz')) {
    const tokenResult = await ensureFreshShopifyToken('shopify_komputerzz', 24)
    if (!tokenResult.ok) {
      return apiError(
        'TOKEN_REFRESH_ERROR',
        `shopify_komputerzz token refresh failed: ${tokenResult.error ?? 'unknown error'}`,
        500
      )
    }
  }

  // Wake local browser runner immediately when Push starts.
  // Runner itself processes only products currently marked 2push.
  await requestRunnerWake('browser', 'channel-availability push')
  const startedAt = new Date().toISOString()
  await db.update(salesChannels)
    .set({ lastPush: startedAt })
    .where(inArray(salesChannels.id, platforms))

  const results = await syncChannelAvailability(
    platforms,
    parsed.data.triggeredBy,
    { protectRecentChannelEditsHours: parsed.data.protectRecentChannelEditsHours }
  )

  return apiResponse(results)
}

