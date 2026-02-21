import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

type Meta = Record<string, unknown>

export function apiResponse<T>(data: T, status = 200, meta?: Meta): NextResponse {
  return NextResponse.json(
    { data, meta: { requestId: randomUUID(), ...meta } },
    { status }
  )
}

export function apiError(
  code: string,
  message: string,
  status: number,
  meta?: Meta
): NextResponse {
  return NextResponse.json(
    { error: { code, message }, meta: { requestId: randomUUID(), ...meta } },
    { status }
  )
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number
): NextResponse {
  return NextResponse.json({
    data,
    meta: {
      requestId: randomUUID(),
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  })
}
