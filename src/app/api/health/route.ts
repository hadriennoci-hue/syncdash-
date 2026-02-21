import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { runApiHealthCheck, getLatestHealthCheck } from '@/lib/functions/health'

export const runtime = 'edge'

const postSchema = z.object({
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// GET — return latest cached health check results
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const result = await getLatestHealthCheck()
  return apiResponse(result)
}

// POST — run a fresh health check now
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (parsed.success) {
    // triggeredBy is informational only for health checks
  }

  const result = await runApiHealthCheck()
  return apiResponse(result)
}
