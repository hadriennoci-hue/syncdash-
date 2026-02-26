import { db } from '@/lib/db/client'
import { runnerSignals } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export type RunnerName = 'browser'

export async function requestRunnerWake(runner: RunnerName, reason: string): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(runnerSignals).values({
    runner,
    wakeNonce: 1,
    reason,
    requestedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: runnerSignals.runner,
    set: {
      wakeNonce: sql`${runnerSignals.wakeNonce} + 1`,
      reason,
      requestedAt: now,
      updatedAt: now,
    },
  })
}

export async function getRunnerSignal(runner: RunnerName): Promise<{
  runner: string
  wakeNonce: number
  reason: string | null
  requestedAt: string
  updatedAt: string
}> {
  const row = await db.query.runnerSignals.findFirst({
    where: eq(runnerSignals.runner, runner),
  })

  if (row) {
    return {
      runner: row.runner,
      wakeNonce: row.wakeNonce,
      reason: row.reason ?? null,
      requestedAt: row.requestedAt,
      updatedAt: row.updatedAt,
    }
  }

  const now = new Date().toISOString()
  await db.insert(runnerSignals).values({
    runner,
    wakeNonce: 0,
    reason: 'autocreate',
    requestedAt: now,
    updatedAt: now,
  }).onConflictDoNothing()

  return {
    runner,
    wakeNonce: 0,
    reason: 'autocreate',
    requestedAt: now,
    updatedAt: now,
  }
}

