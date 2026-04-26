import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { syncJobs } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'
import type { Platform, TriggeredBy } from '@/types/platform'

export const API_CHANNEL_PUSH_JOB_TYPE = 'push_product'
export const BROWSER_CHANNEL_PUSH_JOB_TYPE = 'browser_push'

type ProgressStatus = 'success' | 'error'

export interface ChannelPushJobMessage {
  stage: 'queued' | 'progress' | 'complete' | 'error'
  processedTargets?: number
  totalTargets?: number
  lastProductIds?: string[]
  lastStatus?: ProgressStatus
  detail?: string
  blockedOnSku?: string | null
}

export interface ChannelPushJobSnapshot {
  id: string
  platform: string | null
  status: string
  startedAt: string
  finishedAt: string | null
  touched: number
  zeroed: number
  errorsCount: number
  triggeredBy: string | null
  detail: string | null
  processedTargets: number
  totalTargets: number | null
  lastProductIds: string[]
  lastStatus: ProgressStatus | null
  blockedOnSku: string | null
  jobType: string | null
}

function encodeMessage(payload: ChannelPushJobMessage): string {
  return JSON.stringify(payload)
}

function decodeMessage(raw: string | null): ChannelPushJobMessage | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ChannelPushJobMessage
    if (!parsed || typeof parsed !== 'object' || typeof parsed.stage !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function parseChannelPushJob(row: {
  id: string
  platform: string | null
  status: string
  startedAt: string
  finishedAt: string | null
  touched: number
  zeroed: number
  errorsCount: number
  triggeredBy: string | null
  message: string | null
} | null): ChannelPushJobSnapshot | null {
  if (!row) return null
  const message = decodeMessage(row.message)
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    touched: row.touched,
    zeroed: row.zeroed,
    errorsCount: row.errorsCount,
    triggeredBy: row.triggeredBy,
    detail: message?.detail ?? row.message,
    processedTargets: message?.processedTargets ?? row.touched ?? 0,
    totalTargets: message?.totalTargets ?? null,
    lastProductIds: message?.lastProductIds ?? [],
    lastStatus: message?.lastStatus ?? null,
    blockedOnSku: message?.blockedOnSku ?? null,
    jobType: (row as { jobType?: string | null }).jobType ?? null,
  }
}

export async function createChannelPushJob(
  platform: Platform,
  triggeredBy: TriggeredBy,
  jobType: string = API_CHANNEL_PUSH_JOB_TYPE
): Promise<{ id: string; startedAt: string }> {
  const id = generateId()
  const startedAt = new Date().toISOString()
  await db.insert(syncJobs).values({
    id,
    jobType,
    platform,
    status: 'running',
    startedAt,
    touched: 0,
    errorsCount: 0,
    triggeredBy,
    message: encodeMessage({ stage: 'queued', processedTargets: 0, detail: 'Queued' }),
  })
  return { id, startedAt }
}

export async function updateChannelPushJobProgress(
  jobId: string,
  progress: {
    processedTargets: number
    totalTargets: number
    lastProductIds: string[]
    lastStatus: ProgressStatus
    detail: string
  }
): Promise<void> {
  await db.update(syncJobs)
    .set({
      status: 'running',
      touched: progress.processedTargets,
      errorsCount: progress.lastStatus === 'error' ? 1 : 0,
      message: encodeMessage({
        stage: 'progress',
        processedTargets: progress.processedTargets,
        totalTargets: progress.totalTargets,
        lastProductIds: progress.lastProductIds,
        lastStatus: progress.lastStatus,
        detail: progress.detail,
        blockedOnSku: progress.lastStatus === 'error' ? (progress.lastProductIds[0] ?? null) : null,
      }),
    })
    .where(eq(syncJobs.id, jobId))
}

export async function finishChannelPushJob(
  jobId: string,
  result: {
    status: 'success' | 'error'
    processedTargets: number
    totalTargets: number
    errorsCount: number
    detail: string
    blockedOnSku?: string | null
  }
): Promise<void> {
  await db.update(syncJobs)
    .set({
      status: result.status,
      touched: result.processedTargets,
      errorsCount: result.errorsCount,
      finishedAt: new Date().toISOString(),
      message: encodeMessage({
        stage: result.status === 'success' ? 'complete' : 'error',
        processedTargets: result.processedTargets,
        totalTargets: result.totalTargets,
        detail: result.detail,
        blockedOnSku: result.blockedOnSku ?? null,
        lastStatus: result.status === 'error' ? 'error' : 'success',
        lastProductIds: result.blockedOnSku ? [result.blockedOnSku] : [],
      }),
    })
    .where(eq(syncJobs.id, jobId))
}

export async function markChannelPushJobError(jobId: string, detail: string): Promise<void> {
  await db.update(syncJobs)
    .set({
      status: 'error',
      finishedAt: new Date().toISOString(),
      errorsCount: 1,
      message: encodeMessage({
        stage: 'error',
        detail,
        lastStatus: 'error',
      }),
    })
    .where(eq(syncJobs.id, jobId))
}

export async function getLatestChannelPushJob(platform: Platform) {
  const jobType = platform === 'xmr_bazaar' || platform === 'libre_market'
    ? BROWSER_CHANNEL_PUSH_JOB_TYPE
    : API_CHANNEL_PUSH_JOB_TYPE
  const row = await db.query.syncJobs.findFirst({
    where: and(eq(syncJobs.jobType, jobType), eq(syncJobs.platform, platform)),
    orderBy: [desc(syncJobs.startedAt)],
  })
  return parseChannelPushJob(row ?? null)
}
