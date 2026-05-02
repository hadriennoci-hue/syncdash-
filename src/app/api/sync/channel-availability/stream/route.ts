import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError } from '@/lib/utils/api-response'
import { syncChannelAvailability, type ChannelSyncResult } from '@/lib/functions/channel-sync'
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
  platforms: z.array(z.string()).length(1),
  sku: z.string().trim().min(1).optional(),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
  protectRecentChannelEditsHours: z.number().min(0).max(24 * 30).default(0.5),
})

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const platforms = parsed.data.platforms as Platform[]
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const results: ChannelSyncResult[] = []
      const push = (event: string, data: unknown) => controller.enqueue(encoder.encode(toSse(event, data)))
      const platform = platforms[0]
      let jobId: string | null = null
      let lastProgress: { processedTargets: number; totalTargets: number; blockedOnSku?: string | null } = {
        processedTargets: 0,
        totalTargets: 0,
      }

      void (async () => {
        push('push_start', { totalPlatforms: platforms.length, platforms })
        const job = await createChannelPushJob(platform, parsed.data.triggeredBy)
        jobId = job.id
        const targetSkus = parsed.data.sku ? [parsed.data.sku] : null
        for (const platform of platforms) {
          const issues = targetSkus
            ? (await findUnsavedChannelRows(platform)).filter((issue) => targetSkus.includes(issue.sku))
            : await findUnsavedChannelRows(platform)
          if (issues.length > 0) {
            throw new Error(`${platform} sale channel needs to be saved first (${issues.length} unsaved row(s), first SKU: ${issues[0].sku})`)
          }
        }
        if (platforms.includes('shopify_komputerzz')) {
          const tokenResult = await ensureFreshShopifyToken('shopify_komputerzz', 24)
          if (!tokenResult.ok) {
            throw new Error(`shopify_komputerzz token refresh failed: ${tokenResult.error ?? 'unknown error'}`)
          }
          push('token_refresh', {
            platform: 'shopify_komputerzz',
            refreshed: !!tokenResult.refreshed,
            expiresAt: tokenResult.expiresAt ?? null,
          })
        }
        await requestRunnerWake('browser', 'channel-availability push')
        const startedAt = new Date().toISOString()
        await db.update(salesChannels)
          .set({ lastPush: startedAt })
          .where(inArray(salesChannels.id, platforms))
        push('runner_wake', { runner: 'browser' })

        const finalResults = await syncChannelAvailability(
          platforms,
          parsed.data.triggeredBy,
          {
            protectRecentChannelEditsHours: parsed.data.protectRecentChannelEditsHours,
            skuFilter: targetSkus ?? undefined,
            onPlatformStart: ({ platform, index, total }) => {
              push('platform_start', { platform, index, total })
            },
            onPlatformProgress: async ({ platform, index, total, processedTargets, totalTargets, lastProductIds, lastStatus, message }) => {
              lastProgress = {
                processedTargets,
                totalTargets,
                blockedOnSku: lastStatus === 'error' ? (lastProductIds[0] ?? null) : null,
              }
              if (jobId) {
                await updateChannelPushJobProgress(jobId, {
                  processedTargets,
                  totalTargets,
                  lastProductIds,
                  lastStatus,
                  detail: message,
                })
              }
              push('platform_progress', {
                platform,
                index,
                total,
                processedTargets,
                totalTargets,
                lastProductIds,
                lastStatus,
                message,
              })
            },
            onPlatformComplete: async ({ platform, index, total, result }) => {
              results.push(result)
              if (jobId) {
                const errorsCount = result.errors.length + (result.incomplete?.length ?? 0)
                const blockedOnSku = result.errors[0]?.split(':')[0]
                  ?? result.incomplete?.[0]?.sku
                  ?? lastProgress.blockedOnSku
                  ?? null
                await finishChannelPushJob(jobId, {
                  status: errorsCount > 0 ? 'error' : 'success',
                  processedTargets: lastProgress.processedTargets,
                  totalTargets: lastProgress.totalTargets,
                  errorsCount,
                  detail: result.errors[0]
                    ?? (result.incomplete?.[0]
                      ? `Incomplete: ${result.incomplete[0].sku}`
                      : `${result.statusUpdated} updated, ${result.newProductsCreated} created, ${result.zeroedOutOfStock} zeroed`),
                  blockedOnSku,
                })
              }
              push('platform_result', { platform, index, total, result })
            },
          }
        )

        push('push_done', { results: finalResults })
        controller.close()
      })().catch((err) => {
        if (jobId) {
          void markChannelPushJobError(jobId, err instanceof Error ? err.message : 'Unknown error')
        }
        push('stream_error', { message: err instanceof Error ? err.message : 'Unknown error' })
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
