import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { PLATFORMS } from '@/types/platform'
import type { Platform } from '@/types/platform'


const postSchema = z.object({
  productId:   z.string().min(1),
  platform:    z.string().min(1),
  platformId:  z.string().min(1),
  recordType:  z.enum(['product', 'variant']).default('product'),
})

const deleteSchema = z.object({
  productId: z.string().min(1),
  platform:  z.string().min(1),
})

// GET — list platform mappings (optionally filter by product or platform)
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId') ?? ''
  const platform  = searchParams.get('platform') ?? ''

  const rows = await db.query.platformMappings.findMany({
    orderBy: (t, { asc }) => [asc(t.productId), asc(t.platform)],
  })

  const filtered = rows.filter((r) => {
    if (productId && r.productId !== productId) return false
    if (platform  && r.platform  !== platform)  return false
    return true
  })

  return apiResponse(filtered)
}

// POST — create or update a platform mapping
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  if (!PLATFORMS.includes(parsed.data.platform as Platform)) {
    return apiError('VALIDATION_ERROR', `Unknown platform: ${parsed.data.platform}`, 400)
  }

  const now = new Date().toISOString()
  await db.insert(platformMappings).values({
    productId:  parsed.data.productId,
    platform:   parsed.data.platform,
    platformId: parsed.data.platformId,
    recordType: parsed.data.recordType,
    syncStatus: 'synced',
    updatedAt:  now,
  }).onConflictDoUpdate({
    target:  [platformMappings.productId, platformMappings.platform],
    set:     { platformId: parsed.data.platformId, recordType: parsed.data.recordType, updatedAt: now },
  })

  return apiResponse({ success: true }, 201)
}

// DELETE — remove a platform mapping
export async function DELETE(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await db.delete(platformMappings).where(
    and(
      eq(platformMappings.productId, parsed.data.productId),
      eq(platformMappings.platform,  parsed.data.platform)
    )
  )

  return apiResponse({ success: true })
}
