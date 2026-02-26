import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getRunnerSignal, requestRunnerWake } from '@/lib/functions/runner-signal'

const runnerSchema = z.object({
  runner: z.enum(['browser']).default('browser'),
})

const wakeSchema = z.object({
  runner: z.enum(['browser']).default('browser'),
  reason: z.string().min(1).max(200).default('manual'),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const parsed = runnerSchema.safeParse({
    runner: searchParams.get('runner') ?? 'browser',
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const signal = await getRunnerSignal(parsed.data.runner)
  return apiResponse(signal)
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = wakeSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await requestRunnerWake(parsed.data.runner, parsed.data.reason)
  const signal = await getRunnerSignal(parsed.data.runner)
  return apiResponse(signal)
}

