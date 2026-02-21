import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { suppliers } from '@/lib/db/schema'
import { generateId } from '@/lib/utils/id'

export const runtime = 'edge'

const createSchema = z.object({
  name:    z.string().min(1),
  contact: z.string().optional(),
  email:   z.string().email().optional(),
  phone:   z.string().optional(),
  notes:   z.string().optional(),
})

// GET — list suppliers
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.query.suppliers.findMany({
    orderBy: (t, { asc }) => [asc(t.name)],
  })
  return apiResponse(rows)
}

// POST — create supplier
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const id  = generateId()
  const now = new Date().toISOString()
  await db.insert(suppliers).values({
    id,
    name:      parsed.data.name,
    contact:   parsed.data.contact ?? null,
    email:     parsed.data.email   ?? null,
    phone:     parsed.data.phone   ?? null,
    notes:     parsed.data.notes   ?? null,
    createdAt: now,
  })

  return apiResponse({ id }, 201)
}
