import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import {
  BROWSER_CHANNEL_PUSH_JOB_TYPE,
  createChannelPushJob,
  finishChannelPushJob,
  markChannelPushJobError,
  updateChannelPushJobProgress,
} from '@/lib/functions/channel-push-jobs'
import type { Platform } from '@/types/platform'

const platformSchema = z.enum([
  'coincart2',
  'shopify_komputerzz',
  'shopify_tiktok',
  'ebay_ie',
  'xmr_bazaar',
  'libre_market',
])

const createSchema = z.object({
  platform: platformSchema,
  triggeredBy: z.enum(['human', 'agent']).default('agent'),
  jobType: z.string().min(1).max(50).default(BROWSER_CHANNEL_PUSH_JOB_TYPE),
})

const progressSchema = z.object({
  jobId: z.string().uuid(),
  processedTargets: z.number().int().min(0),
  totalTargets: z.number().int().min(0),
  lastProductIds: z.array(z.string()).default([]),
  lastStatus: z.enum(['success', 'error']),
  detail: z.string().min(1).max(5000),
})

const finishSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(['success', 'error']),
  processedTargets: z.number().int().min(0),
  totalTargets: z.number().int().min(0),
  zeroed: z.number().int().min(0).default(0),
  errorsCount: z.number().int().min(0),
  detail: z.string().min(1).max(5000),
  blockedOnSku: z.string().nullable().optional(),
})

const errorSchema = z.object({
  jobId: z.string().uuid(),
  detail: z.string().min(1).max(5000),
})

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const job = await createChannelPushJob(
    parsed.data.platform as Platform,
    parsed.data.triggeredBy,
    parsed.data.jobType
  )
  return apiResponse(job, 201)
}

export async function PATCH(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'progress') {
    const parsed = progressSchema.safeParse(body)
    if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
    await updateChannelPushJobProgress(parsed.data.jobId, {
      processedTargets: parsed.data.processedTargets,
      totalTargets: parsed.data.totalTargets,
      lastProductIds: parsed.data.lastProductIds,
      lastStatus: parsed.data.lastStatus,
      detail: parsed.data.detail,
    })
    return apiResponse({ success: true })
  }

  if (action === 'finish') {
    const parsed = finishSchema.safeParse(body)
    if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
    await finishChannelPushJob(parsed.data.jobId, {
      status: parsed.data.status,
      processedTargets: parsed.data.processedTargets,
      totalTargets: parsed.data.totalTargets,
      zeroed: parsed.data.zeroed,
      errorsCount: parsed.data.errorsCount,
      detail: parsed.data.detail,
      blockedOnSku: parsed.data.blockedOnSku ?? null,
    })
    return apiResponse({ success: true })
  }

  if (action === 'error') {
    const parsed = errorSchema.safeParse(body)
    if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)
    await markChannelPushJobError(parsed.data.jobId, parsed.data.detail)
    return apiResponse({ success: true })
  }

  return apiError('VALIDATION_ERROR', 'Unknown sync job action', 400)
}
