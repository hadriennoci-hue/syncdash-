import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { tiktokSelection } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'


// DELETE — remove product from TikTok selection
export async function DELETE(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const existing = await db.query.tiktokSelection.findFirst({
    where: eq(tiktokSelection.productId, params.sku),
  })
  if (!existing) return apiError('NOT_FOUND', `SKU ${params.sku} not in TikTok selection`, 404)

  await db.delete(tiktokSelection).where(eq(tiktokSelection.productId, params.sku))
  return apiResponse({ success: true })
}
