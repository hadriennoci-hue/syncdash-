import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError, paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { createOrder } from '@/lib/functions/orders'


const createSchema = z.object({
  invoiceNumber: z.string().optional(),
  supplierId:    z.string().optional(),
  warehouseId:   z.string().min(1),
  orderDate:     z.string().optional(),
  items:         z.array(z.object({
    productId:     z.string().min(1),
    quantity:      z.number().int().positive(),
    purchasePrice: z.number().positive().optional(),
  })).min(1),
  triggeredBy:   z.enum(['human', 'agent']).default('human'),
})

// GET — list orders
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page       = parseInt(searchParams.get('page') ?? '1')
  const perPage    = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const warehouseId = searchParams.get('warehouseId') ?? ''
  const supplierId  = searchParams.get('supplierId') ?? ''
  const offset     = (page - 1) * perPage

  const rows = await db.query.orders.findMany({
    with: {
      supplier: { columns: { id: true, name: true } },
      items:    { with: { product: { columns: { id: true, title: true } } } },
    },
    limit:   perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.orderDate)],
  })

  const filtered = rows.filter((o) => {
    if (warehouseId && o.warehouseId !== warehouseId) return false
    if (supplierId  && o.supplierId  !== supplierId)  return false
    return true
  })

  return paginatedResponse(filtered, filtered.length, page, perPage)
}

// POST — create a purchase order
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const order = await createOrder(parsed.data, parsed.data.triggeredBy)
  return apiResponse(order, 201)
}
