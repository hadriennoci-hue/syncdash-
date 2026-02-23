import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { runDailySync } from '@/lib/automation/daily-sync'


// GET — list daily sync log entries
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30'), 90)

  const rows = await db.query.dailySyncLog.findMany({
    limit,
    orderBy: (t, { desc }) => [desc(t.syncedAt)],
  })

  return apiResponse(rows)
}

// POST — trigger daily sync manually
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  await runDailySync()
  return apiResponse({ success: true })
}
