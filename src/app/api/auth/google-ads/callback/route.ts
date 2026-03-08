import { NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { platformTokens } from '@/lib/db/schema'
import { apiError, apiResponse } from '@/lib/utils/api-response'

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

function resolveRedirectUri(req: NextRequest): string {
  const configured = process.env.GOOGLE_ADS_REDIRECT_URI?.trim()
  if (configured) return configured
  return `${req.nextUrl.origin}/api/auth/google-ads/callback`
}

/**
 * GET /api/auth/google-ads/callback
 *
 * OAuth callback endpoint for Google Ads authorization_code flow.
 * Exchanges the returned `code` for tokens and stores them in D1.
 */
export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get('error')
  const errorDescription = req.nextUrl.searchParams.get('error_description')
  const code = req.nextUrl.searchParams.get('code')

  if (error) {
    return apiError(
      'GOOGLE_ADS_OAUTH_ERROR',
      errorDescription ? `${error}: ${errorDescription}` : error,
      400
    )
  }

  if (!code) {
    return apiError(
      'GOOGLE_ADS_OAUTH_ERROR',
      'Missing authorization code in callback query params',
      400
    )
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return apiError(
      'GOOGLE_ADS_CONFIG_ERROR',
      'Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET',
      500
    )
  }

  const redirectUri = resolveRedirectUri(req)
  const payload = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  })

  if (!tokenRes.ok) {
    return apiError(
      'GOOGLE_ADS_TOKEN_EXCHANGE_FAILED',
      `Google token endpoint ${tokenRes.status}: ${await tokenRes.text()}`,
      502
    )
  }

  const tokenData = await tokenRes.json() as GoogleTokenResponse
  if (!tokenData.access_token) {
    return apiError(
      'GOOGLE_ADS_TOKEN_EXCHANGE_FAILED',
      'Google token response did not include access_token',
      502
    )
  }

  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ((tokenData.expires_in ?? 3600) * 1000)).toISOString()
  const storedSecret = JSON.stringify({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    tokenType: tokenData.token_type ?? null,
    scope: tokenData.scope ?? null,
    obtainedAt: nowIso,
  })

  await db
    .insert(platformTokens)
    .values({
      platform: 'google_ads',
      accessToken: storedSecret,
      // Keep token usable even if access token expires; refresh token is the durable credential.
      expiresAt: tokenData.refresh_token ? '2099-12-31T23:59:59.000Z' : expiresAt,
      refreshedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: platformTokens.platform,
      set: {
        accessToken: storedSecret,
        expiresAt: tokenData.refresh_token ? '2099-12-31T23:59:59.000Z' : expiresAt,
        refreshedAt: nowIso,
      },
    })

  return apiResponse({
    connected: true,
    provider: 'google_ads',
    redirectUri,
    hasRefreshToken: Boolean(tokenData.refresh_token),
    scope: tokenData.scope ?? null,
    message: tokenData.refresh_token
      ? 'Google Ads OAuth connected and refresh token stored.'
      : 'OAuth connected, but no refresh token returned. Re-authorize with prompt=consent and access_type=offline.',
  })
}
