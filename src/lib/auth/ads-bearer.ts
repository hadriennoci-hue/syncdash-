import { NextRequest, NextResponse } from 'next/server'

/**
 * Read-only bearer verification for external advertising agent endpoints.
 * Accepts ADS_AGENT_BEARER_TOKEN, with AGENT_BEARER_TOKEN as admin fallback.
 */
export function verifyAdsReadBearer(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get('authorization')
  const adsToken = process.env.ADS_AGENT_BEARER_TOKEN
  const adminToken = process.env.AGENT_BEARER_TOKEN

  if (!adsToken && !adminToken) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'No bearer token configured for ads read endpoints' } },
      { status: 500 }
    )
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' } },
      { status: 401 }
    )
  }

  const provided = authHeader.slice(7)
  if (provided !== adsToken && provided !== adminToken) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
      { status: 401 }
    )
  }

  return null
}
