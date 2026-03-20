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
import type { Platform } from '@/types/platform'

const schema = z.object({
  platforms: z.array(z.string()).min(1).default(['shopify_komputerzz', 'coincart2', 'libre_market', 'xmr_bazaar']),
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

      void (async () => {
        push('push_start', { totalPlatforms: platforms.length, platforms })
        for (const platform of platforms) {
          const issues = await findUnsavedChannelRows(platform)
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
            onPlatformStart: ({ platform, index, total }) => {
              push('platform_start', { platform, index, total })
            },
            onPlatformProgress: ({ platform, index, total, processedTargets, totalTargets, lastProductIds, lastStatus, message }) => {
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
            onPlatformComplete: ({ platform, index, total, result }) => {
              results.push(result)
              push('platform_result', { platform, index, total, result })
            },
          }
        )

        push('push_done', { results: finalResults })
        controller.close()
      })().catch((err) => {
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
