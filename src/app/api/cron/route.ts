import { NextRequest } from 'next/server'
import { runDailyHealthCheck, runDailyTokenRefresh } from '@/lib/automation/daily-sync'
import { verifyBearer } from '@/lib/auth/bearer'
import { runAdsPublishCron } from '@/lib/functions/ads-publish'
import { runSocialAnalyticsSync } from '@/lib/functions/social-analytics-sync'
import { runSocialPublishCron } from '@/lib/functions/social-publish'
import { runXAdsAnalyticsSync } from '@/lib/functions/x-ads'

// Internal Cloudflare Cron endpoint - NOT secured with bearer (called by Cloudflare)
// Cloudflare Cron Triggers call GET /api/cron with a scheduled header.
// Schedules:
// - 0 4 * * * -> tokens
// - 0 6 * * * -> health + social analytics
// - */10 * * * * -> social publish
export async function GET(req: NextRequest) {
  const cronHeader = req.headers.get('x-cloudflare-scheduled')
  const scheduledTask = (
    cronHeader === '0 4 * * *' ? 'tokens'
      : cronHeader === '*/10 * * * *' ? 'social'
      : 'health'
  )

  // Manual override for local/dev usage: /api/cron?task=tokens|health|social|social_analytics|ads|ads_analytics
  const task = req.nextUrl.searchParams.get('task') ?? scheduledTask

  if (task === 'tokens') {
    await runDailyTokenRefresh()
    return new Response('daily token refresh done', { status: 200 })
  }

  if (task === 'health') {
    await runDailyHealthCheck()
    const analytics = await runSocialAnalyticsSync('system')
    const adsAnalytics = await runXAdsAnalyticsSync()
    return new Response(`health check done; social analytics: scanned=${analytics.scannedPosts} syncedPosts=${analytics.syncedPosts} syncedAccounts=${analytics.syncedAccounts} errors=${analytics.errors.length}; x ads analytics: syncedCampaigns=${adsAnalytics.syncedCampaigns} upserts=${adsAnalytics.upserts} errors=${adsAnalytics.errors.length}`, { status: 200 })
  }

  if (task === 'social') {
    const result = await runSocialPublishCron()
    return new Response(`social publish done: scanned=${result.scanned} published=${result.published} failed=${result.failed}`, { status: 200 })
  }

  if (task === 'social_analytics') {
    const result = await runSocialAnalyticsSync('system')
    return new Response(`social analytics done: scanned=${result.scannedPosts} syncedPosts=${result.syncedPosts} syncedAccounts=${result.syncedAccounts} errors=${result.errors.length}`, { status: 200 })
  }

  if (task === 'ads') {
    if (!cronHeader) {
      const auth = verifyBearer(req)
      if (auth) return auth
    }
    const result = await runAdsPublishCron()
    return new Response(`ads publish done: enabled=${result.enabled} scanned=${result.scanned} published=${result.published} failed=${result.failed} skipped=${result.skipped}`, { status: 200 })
  }

  if (task === 'ads_analytics') {
    if (!cronHeader) {
      const auth = verifyBearer(req)
      if (auth) return auth
    }
    const result = await runXAdsAnalyticsSync()
    return new Response(`x ads analytics done: syncedCampaigns=${result.syncedCampaigns} upserts=${result.upserts} errors=${result.errors.length}`, { status: 200 })
  }

  return new Response('health check done', { status: 200 })
}
