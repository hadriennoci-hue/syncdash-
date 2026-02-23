import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { analyzeInconsistencies } from '@/lib/functions/analyze'


// GET — analyze inconsistencies across all products
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const results = await analyzeInconsistencies()
  return apiResponse(results)
}
