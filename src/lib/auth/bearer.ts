import { NextRequest, NextResponse } from 'next/server'

export function verifyBearer(req: NextRequest): NextResponse | null {
  const cfAccessEmail = req.headers.get('cf-access-authenticated-user-email')
  if (cfAccessEmail) {
    return null
  }

  const authHeader = req.headers.get('authorization')
  const token = process.env.AGENT_BEARER_TOKEN

  if (!token) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'AGENT_BEARER_TOKEN not configured' } },
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
  if (provided !== token) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
      { status: 401 }
    )
  }

  return null
}
