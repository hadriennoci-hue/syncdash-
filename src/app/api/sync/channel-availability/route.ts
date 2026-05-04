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
import {
  createChannelPushJob,
  finishChannelPushJob,
  markChannelPushJobError,
  updateChannelPushJobProgress,
} from '@/lib/functions/channel-push-jobs'
import type { Platform } from '@/types/platform'


const schema = z.object({
  platforms:   z.array(z.string()).length(1),
  sku: z.string().trim().min(1).optional(),
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
  const platform = platforms[0]
  const targetSkus = parsed.data.sku ? [parsed.data.sku] : null
  let lastProgress = { processedTargets: 0, totalTargets: 0, blockedOnSku: null as string | null }

  for (const platform of platforms) {
    const issues = targetSkus
      ? (await findUnsavedChannelRows(platform)).filter((issue) => targetSkus.includes(issue.sku))
      : await findUnsavedChannelRows(platform)
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
  // Browser runner processes queued products plus existing mapped browser listings.
  await requestRunnerWake('browser', 'channel-availability push')
  const startedAt = new Date().toISOString()
  await db.update(salesChannels)
    .set({ lastPush: startedAt })
    .where(inArray(salesChannels.id, platforms))

  const job = await createChannelPushJob(platform, parsed.data.triggeredBy)

  try {
    const results = await syncChannelAvailability(
      platforms,
      parsed.data.triggeredBy,
      {
        protectRecentChannelEditsHours: parsed.data.protectRecentChannelEditsHours,
        skuFilter: targetSkus ?? undefined,
        onPlatformProgress: async ({ processedTargets, totalTargets, lastProductIds, lastStatus, message }) => {
          lastProgress = {
            processedTargets,
            totalTargets,
            blockedOnSku: lastStatus === 'error' ? (lastProductIds[0] ?? null) : null,
          }
          await updateChannelPushJobProgress(job.id, {
            processedTargets,
            totalTargets,
            lastProductIds,
            lastStatus,
            detail: message,
          })
        },
      }
    )

    const result = results[0]
    const errorsCount = (result?.errors.length ?? 0) + (result?.incomplete?.length ?? 0)
    const blockedOnSku = result?.errors[0]?.split(':')[0]
      ?? result?.incomplete?.[0]?.sku
      ?? lastProgress.blockedOnSku
      ?? null
    await finishChannelPushJob(job.id, {
      status: errorsCount > 0 ? 'error' : 'success',
      processedTargets: lastProgress.processedTargets,
      totalTargets: lastProgress.totalTargets,
      zeroed: result?.zeroedOutOfStock ?? 0,
      errorsCount,
      detail: result?.errors[0]
        ?? (result?.incomplete?.[0]
          ? `Incomplete: ${result.incomplete[0].sku}`
          : `${result?.statusUpdated ?? 0} updated, ${result?.newProductsCreated ?? 0} created, ${result?.zeroedOutOfStock ?? 0} zeroed`),
      blockedOnSku,
    })

    return apiResponse(results)
  } catch (err) {
    await markChannelPushJobError(job.id, err instanceof Error ? err.message : 'Unknown error')
    throw err
  }
}
