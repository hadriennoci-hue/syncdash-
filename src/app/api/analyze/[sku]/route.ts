import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { analyzeInconsistencies } from '@/lib/functions/analyze'


// GET — analyze inconsistencies for a single product
export async function GET(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const results = await analyzeInconsistencies(params.sku)
  if (results.length === 0) {
    return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)
  }
  return apiResponse(results[0])
}
