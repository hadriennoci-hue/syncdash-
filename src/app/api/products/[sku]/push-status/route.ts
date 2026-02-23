import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const schema = z.object({
  platform: z.enum(['woocommerce', 'shopify_komputerzz', 'shopify_tiktok']),
  status:   z.enum(['N', '2push', 'done']),
})

const COLUMN_MAP = {
  woocommerce:        'pushedWoocommerce',
  shopify_komputerzz: 'pushedShopifyKomputerzz',
  shopify_tiktok:     'pushedShopifyTiktok',
} as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body   = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const col = COLUMN_MAP[parsed.data.platform]

  const existing = await db.query.products.findFirst({ where: eq(products.id, params.sku) })
  if (!existing) return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)

  await db.update(products)
    .set({ [col]: parsed.data.status, updatedAt: new Date().toISOString() })
    .where(eq(products.id, params.sku))

  return apiResponse({ sku: params.sku, platform: parsed.data.platform, status: parsed.data.status })
}
