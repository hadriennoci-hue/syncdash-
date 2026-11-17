import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { verifyBearer, bearerRole } from './bearer'

const req = (method: string, token?: string) =>
  new NextRequest('https://wizhard.store/api/x', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('verifyBearer with a read-only token', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.AGENT_BEARER_TOKEN = 'ADMIN'
    process.env.AGENT_READONLY_TOKEN = 'RO'
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('identifies the role', () => {
    expect(bearerRole(req('GET', 'ADMIN'))).toBe('admin')
    expect(bearerRole(req('GET', 'RO'))).toBe('readonly')
    expect(bearerRole(req('GET', 'nope'))).toBeNull()
  })

  it('admin token passes on any method', () => {
    expect(verifyBearer(req('POST', 'ADMIN'))).toBeNull()
    expect(verifyBearer(req('DELETE', 'ADMIN'))).toBeNull()
  })

  it('read-only token passes on GET, is refused on writes', () => {
    expect(verifyBearer(req('GET', 'RO'))).toBeNull()
    expect(verifyBearer(req('POST', 'RO'))?.status).toBe(403)
    expect(verifyBearer(req('PATCH', 'RO'))?.status).toBe(403)
    expect(verifyBearer(req('DELETE', 'RO'))?.status).toBe(403)
  })

  it('read-only token passes on a POST route that opts in', () => {
    expect(verifyBearer(req('POST', 'RO'), { allowReadOnly: true })).toBeNull()
  })

  it('unknown token is refused', () => {
    expect(verifyBearer(req('GET', 'nope'))?.status).toBe(401)
  })

  it('read-only token is ignored when not configured', () => {
    delete process.env.AGENT_READONLY_TOKEN
    expect(verifyBearer(req('GET', 'RO'))?.status).toBe(401)
  })
})
