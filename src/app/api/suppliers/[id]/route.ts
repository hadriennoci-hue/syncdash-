import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { suppliers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'edge'

const patchSchema = z.object({
  name:    z.string().min(1).optional(),
  contact: z.string().optional(),
  email:   z.string().email().optional(),
  phone:   z.string().optional(),
  notes:   z.string().optional(),
})

// GET — supplier detail
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, params.id),
  })
  if (!supplier) return apiError('NOT_FOUND', `Supplier ${params.id} not found`, 404)

  const products = await db.query.products.findMany({
    where: (p, { eq: eqFn }) => eqFn(p.supplierId, params.id),
    columns: { id: true, title: true, status: true },
    orderBy: (t, { asc }) => [asc(t.title)],
  })

  return apiResponse({ ...supplier, products })
}

// PATCH — update supplier
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const existing = await db.query.suppliers.findFirst({ where: eq(suppliers.id, params.id) })
  if (!existing) return apiError('NOT_FOUND', `Supplier ${params.id} not found`, 404)

  await db.update(suppliers).set(parsed.data).where(eq(suppliers.id, params.id))
  return apiResponse({ success: true })
}
