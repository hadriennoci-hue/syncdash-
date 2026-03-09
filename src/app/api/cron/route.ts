import { NextRequest } from 'next/server'
import { runDailySync, runDailyHealthCheck, runDailyTokenRefresh } from '@/lib/automation/daily-sync'

// Internal Cloudflare Cron endpoint - NOT secured with bearer (called by Cloudflare)
// Cloudflare Cron Triggers call GET /api/cron with a scheduled header.
// Schedules:
// - 0 4 * * * -> tokens
// - 0 5 * * * -> sync
// - 0 6 * * * -> health
export async function GET(req: NextRequest) {
  const cronHeader = req.headers.get('x-cloudflare-scheduled')
  const scheduledTask = (
    cronHeader === '0 4 * * *' ? 'tokens'
      : cronHeader === '0 6 * * *' ? 'health'
        : 'sync'
  )

  // Manual override for local/dev usage: /api/cron?task=tokens|sync|health
  const task = req.nextUrl.searchParams.get('task') ?? scheduledTask

  if (task === 'tokens') {
    await runDailyTokenRefresh()
    return new Response('daily token refresh done', { status: 200 })
  }

  if (task === 'health') {
    await runDailyHealthCheck()
    return new Response('health check done', { status: 200 })
  }

  await runDailySync()
  return new Response('daily sync done', { status: 200 })
}
