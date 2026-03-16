import { NextRequest } from 'next/server'
import { runDailyHealthCheck, runDailyTokenRefresh } from '@/lib/automation/daily-sync'
import { runSocialPublishCron } from '@/lib/functions/social-publish'

// Internal Cloudflare Cron endpoint - NOT secured with bearer (called by Cloudflare)
// Cloudflare Cron Triggers call GET /api/cron with a scheduled header.
// Schedules:
// - 0 4 * * * -> tokens
// - 0 6 * * * -> health
// - */10 * * * * -> social publish
export async function GET(req: NextRequest) {
  const cronHeader = req.headers.get('x-cloudflare-scheduled')
  const scheduledTask = (
    cronHeader === '0 4 * * *' ? 'tokens'
      : cronHeader === '*/10 * * * *' ? 'social'
      : 'health'
  )

  // Manual override for local/dev usage: /api/cron?task=tokens|health|social
  const task = req.nextUrl.searchParams.get('task') ?? scheduledTask

  if (task === 'tokens') {
    await runDailyTokenRefresh()
    return new Response('daily token refresh done', { status: 200 })
  }

  if (task === 'health') {
    await runDailyHealthCheck()
    return new Response('health check done', { status: 200 })
  }

  if (task === 'social') {
    const result = await runSocialPublishCron()
    return new Response(`social publish done: scanned=${result.scanned} published=${result.published} failed=${result.failed}`, { status: 200 })
  }

  return new Response('health check done', { status: 200 })
}
