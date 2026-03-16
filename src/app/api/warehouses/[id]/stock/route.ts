import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { overrideWarehouseStock } from '@/lib/functions/warehouses'
import { db } from '@/lib/db/client'
import { warehouseStock } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// GET — list all stock entries for a warehouse (includes sourceUrl)
// ?withProduct=1  → also returns status, imageCount, attributeCount per product
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const withProduct = req.nextUrl.searchParams.get('withProduct') === '1'

  if (withProduct) {
    const rows = await db.query.warehouseStock.findMany({
      where: eq(warehouseStock.warehouseId, params.id),
      columns: { productId: true, quantity: true, sourceUrl: true, sourceName: true, updatedAt: true },
      with: {
        product: {
          columns: { status: true },
          with: {
            images:     { columns: { id: true } },
            metafields: { columns: { id: true } },
          },
        },
      },
    })

    const stock = rows.map(r => ({
      productId:      r.productId,
      quantity:       r.quantity,
      sourceUrl:      r.sourceUrl,
      sourceName:     r.sourceName,
      updatedAt:      r.updatedAt,
      status:         r.product?.status ?? null,
      imageCount:     r.product?.images.length ?? 0,
      attributeCount: r.product?.metafields.length ?? 0,
    }))

    return apiResponse({ warehouseId: params.id, count: stock.length, stock })
  }

  const rows = await db.query.warehouseStock.findMany({
    where: eq(warehouseStock.warehouseId, params.id),
    columns: { productId: true, quantity: true, sourceUrl: true, sourceName: true, updatedAt: true },
  })

  return apiResponse({ warehouseId: params.id, count: rows.length, stock: rows })
}

const patchSchema = z.object({
  productId:       z.string().min(1),
  quantity:        z.number().int().min(0).optional(),
  quantityOrdered: z.number().int().min(0).optional(),
  purchasePrice:   z.number().positive().optional(),
  triggeredBy:     z.enum(['human', 'agent']).default('human'),
})

// PATCH — manually override stock for a product in a warehouse
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  try {
    await overrideWarehouseStock(
      params.id,
      parsed.data.productId,
      {
        quantity:        parsed.data.quantity,
        quantityOrdered: parsed.data.quantityOrdered,
        purchasePrice:   parsed.data.purchasePrice,
      },
      parsed.data.triggeredBy
    )
    return apiResponse({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('read-only') || message.includes('canModifyStock')) {
      return apiError('FORBIDDEN', message, 403)
    }
    return apiError('INTERNAL_ERROR', message, 500)
  }
}
