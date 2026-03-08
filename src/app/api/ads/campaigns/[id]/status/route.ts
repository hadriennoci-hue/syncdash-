import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { adsAccounts, adsCampaigns, adsPublishJobs } from '@/lib/db/schema'

const schema = z.object({
  status: z.enum(['draft', 'approved', 'scheduled', 'live', 'paused', 'completed', 'canceled']),
  scheduledFor: z.string().datetime().optional(),
  triggeredBy: z.enum(['human', 'agent', 'system']).default('human'),
})

// PATCH /api/ads/campaigns/:id/status
// approved = validated but not queued
// scheduled = validated + queued publish job
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const campaignPk = Number(params.id)
  if (!Number.isFinite(campaignPk) || campaignPk <= 0) {
    return apiError('VALIDATION_ERROR', 'Invalid campaign id', 400)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const row = await db.query.adsCampaigns.findFirst({
    where: eq(adsCampaigns.campaignPk, campaignPk),
    columns: {
      campaignPk: true,
      accountPk: true,
      destinationPending: true,
    },
  })
  if (!row) {
    return apiError('NOT_FOUND', `campaign ${campaignPk} not found`, 404)
  }

  if (parsed.data.status === 'scheduled') {
    if (!parsed.data.scheduledFor) {
      return apiError('VALIDATION_ERROR', 'scheduledFor is required when status=scheduled', 400)
    }
    if (row.destinationPending === 1) {
      return apiError('VALIDATION_ERROR', 'Cannot schedule campaign: destination is still pending', 400)
    }

    const account = await db.query.adsAccounts.findFirst({
      where: eq(adsAccounts.accountPk, row.accountPk),
      columns: { providerId: true },
    })
    if (!account) {
      return apiError('NOT_FOUND', `ads account ${row.accountPk} not found`, 404)
    }

    await db.insert(adsPublishJobs).values({
      providerId: account.providerId,
      accountPk: row.accountPk,
      targetType: 'campaign',
      targetPk: row.campaignPk,
      action: 'publish',
      scheduledFor: parsed.data.scheduledFor,
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      idempotencyKey: `campaign-${row.campaignPk}-publish-${parsed.data.scheduledFor}`,
      lastError: null,
      requestJson: null,
      responseJson: null,
      startedAt: null,
      finishedAt: null,
      createdBy: parsed.data.triggeredBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing()
  }

  await db.update(adsCampaigns).set({
    status: parsed.data.status,
    approvedBy: parsed.data.status === 'approved' ? parsed.data.triggeredBy : undefined,
    updatedAt: new Date().toISOString(),
  }).where(eq(adsCampaigns.campaignPk, campaignPk))

  return apiResponse({ ok: true })
}
