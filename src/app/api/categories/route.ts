import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const rows = await db.select().from(categories)

  return apiResponse(rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    parentId: c.parentId,
    collectionType: c.collectionType,
  })))
}
