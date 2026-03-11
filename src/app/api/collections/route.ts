import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')

  const where = platform ? eq(categories.platform, platform) : undefined

  const rows = await db.select().from(categories).where(where)

  return apiResponse(rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    platform: c.platform,
    collectionType: c.collectionType,
  })))
}

