import { NextRequest, NextResponse } from 'next/server'

export type BearerRole = 'admin' | 'readonly'

/**
 * Which agent token was presented: AGENT_BEARER_TOKEN (admin, read/write) or
 * AGENT_READONLY_TOKEN (read-only). Null when absent or unknown.
 */
export function bearerRole(req: NextRequest): BearerRole | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const provided = authHeader.slice(7)
  const admin = process.env.AGENT_BEARER_TOKEN
  const readonly = process.env.AGENT_READONLY_TOKEN
  if (admin && provided === admin) return 'admin'
  if (readonly && provided === readonly) return 'readonly'
  return null
}

const READ_METHODS = new Set(['GET', 'HEAD'])

/**
 * Auth guard for agent API routes.
 * - CF Access users and the admin token: everything.
 * - The read-only token: GET/HEAD only, unless the route opts in with `allowReadOnly`
 *   (a POST route that is itself read-only or checks the request further).
 */
export function verifyBearer(req: NextRequest, opts: { allowReadOnly?: boolean } = {}): NextResponse | null {
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

  const role = bearerRole(req)
  if (role === 'admin') return null
  if (role === 'readonly') {
    if (READ_METHODS.has(req.method.toUpperCase()) || opts.allowReadOnly) return null
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Read-only token: write requests are not allowed' } },
      { status: 403 }
    )
  }

  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
    { status: 401 }
  )
}
