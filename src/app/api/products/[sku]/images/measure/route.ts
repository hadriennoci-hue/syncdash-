import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { measureProductImages } from '@/lib/functions/measure-images'

/** POST /api/products/[sku]/images/measure — fetch each image, store its size, re-rate. */
export async function POST(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth
  return apiResponse(await measureProductImages(params.sku))
}
