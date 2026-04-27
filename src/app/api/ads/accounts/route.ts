import { NextRequest } from 'next/server'
import { asc, eq, inArray } from 'drizzle-orm'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { adsAccounts } from '@/lib/db/schema'

function readDummyMode(configJson: string | null): boolean {
  if (!configJson) return false
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>
    return parsed.dummyMode === 1 || parsed.dummyMode === true
  } catch {
    return false
  }
}

// GET /api/ads/accounts
// Returns visible ads accounts for active providers.
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.query.adsAccounts.findMany({
    where: inArray(adsAccounts.providerId, ['google_ads', 'x_ads', 'tiktok_ads']),
    columns: {
      accountPk: true,
      providerId: true,
      accountName: true,
      accountExternalId: true,
      currencyCode: true,
      timezone: true,
      status: true,
      configJson: true,
    },
    orderBy: [asc(adsAccounts.providerId), asc(adsAccounts.accountName)],
  })

  return apiResponse(rows.map((row) => ({
    accountPk: row.accountPk,
    providerId: row.providerId,
    accountName: row.accountName,
    accountExternalId: row.accountExternalId,
    currencyCode: row.currencyCode,
    timezone: row.timezone,
    status: row.status,
    dummyMode: readDummyMode(row.configJson),
  })))
}
