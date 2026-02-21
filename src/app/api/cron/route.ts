import { NextRequest } from 'next/server'
import { runDailySync, runDailyHealthCheck } from '@/lib/automation/daily-sync'

export const runtime = 'edge'

// Internal Cloudflare Cron endpoint — NOT secured with bearer (called by Cloudflare)
// Cloudflare Cron Triggers call GET /api/cron with a scheduled header
export async function GET(req: NextRequest) {
  const cronHeader = req.headers.get('x-cloudflare-scheduled')
  const task       = req.nextUrl.searchParams.get('task') ?? 'sync'

  // Allow manual trigger in dev (no cron header) or actual Cloudflare cron
  if (task === 'health') {
    await runDailyHealthCheck()
    return new Response('health check done', { status: 200 })
  }

  await runDailySync()
  return new Response('daily sync done', { status: 200 })
}
