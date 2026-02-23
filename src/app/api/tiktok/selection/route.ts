import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError, paginatedResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { tiktokSelection } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'


const postSchema = z.object({
  sku:         z.string().min(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// GET — list products in TikTok selection
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const page    = parseInt(searchParams.get('page') ?? '1')
  const perPage = Math.min(parseInt(searchParams.get('perPage') ?? '50'), 200)
  const offset  = (page - 1) * perPage

  const rows = await db.query.tiktokSelection.findMany({
    with: {
      product: {
        columns: { id: true, title: true, status: true },
        with:    { images: { limit: 1 } },
      },
    },
    limit:   perPage,
    offset,
    orderBy: (t, { desc }) => [desc(t.addedAt)],
  })

  return paginatedResponse(rows, rows.length, page, perPage)
}

// POST — add product to TikTok selection
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await db.insert(tiktokSelection).values({
    productId: parsed.data.sku,
    addedAt:   new Date().toISOString(),
  }).onConflictDoNothing()

  return apiResponse({ success: true }, 201)
}
