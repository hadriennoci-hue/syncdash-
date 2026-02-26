import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { updateOrder } from '@/lib/functions/orders'


const patchSchema = z.object({
  invoiceNumber: z.string().optional(),
  paid:          z.boolean().optional(),
  sentToSupplier: z.boolean().optional(),
  arrivalStatus: z.enum(['pending', 'partial', 'arrived']).optional(),
  items:         z.array(z.object({
    productId:         z.string(),
    quantityReceived:  z.number().int().min(0),
  })).optional(),
  triggeredBy:   z.enum(['human', 'agent']).default('human'),
})

// GET — order detail
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, params.id),
    with: {
      supplier: true,
      items:    { with: { product: { columns: { id: true, title: true, status: true } } } },
    },
  })
  if (!order) return apiError('NOT_FOUND', `Order ${params.id} not found`, 404)
  return apiResponse(order)
}

// PATCH — update order (mark paid, sent, arrival, received qty)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await updateOrder(params.id, parsed.data, parsed.data.triggeredBy)
  return apiResponse({ success: true })
}
