import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { verifyBearer } from '@/lib/auth/bearer'
import { db } from '@/lib/db/client'
import { platformTokens } from '@/lib/db/schema'
import { apiResponse } from '@/lib/utils/api-response'

function fingerprint(value: string | undefined): {
  configured: boolean
  rawLength: number
  trimmedLength: number
  start: string | null
  end: string | null
  hadOuterWhitespace: boolean
} {
  const raw = value ?? ''
  const trimmed = raw.trim()
  return {
    configured: trimmed.length > 0,
    rawLength: raw.length,
    trimmedLength: trimmed.length,
    start: trimmed ? trimmed.slice(0, 5) : null,
    end: trimmed ? trimmed.slice(-5) : null,
    hadOuterWhitespace: raw.length !== trimmed.length,
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const token = await db.query.platformTokens.findFirst({
    where: eq(platformTokens.platform, 'google_ads'),
    columns: {
      platform: true,
      expiresAt: true,
      refreshedAt: true,
      accessToken: true,
    },
  })

  return apiResponse({
    env: {
      googleAdsDeveloperToken: fingerprint(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
      googleAdsCustomerId: fingerprint(process.env.GOOGLE_ADS_CUSTOMER_ID),
      googleAdsLoginCustomerId: fingerprint(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
      googleAdsApiVersion: process.env.GOOGLE_ADS_API_VERSION?.trim() || null,
    },
    storedOAuth: token ? {
      platform: token.platform,
      expiresAt: token.expiresAt,
      refreshedAt: token.refreshedAt,
      accessTokenConfigured: Boolean(token.accessToken?.trim()),
    } : null,
  })
}
