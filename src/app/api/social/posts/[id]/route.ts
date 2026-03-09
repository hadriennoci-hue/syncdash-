import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialMediaPosts } from '@/lib/db/schema'

const patchSchema = z.object({
  status: z.enum(['suggested', 'validated', 'canceled', 'published']),
  scheduledFor: z.string().datetime().optional(),
  externalPostId: z.string().optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).max(4).optional(),
  hypothesis: z.string().max(500).optional(),
  variantLabel: z.string().max(120).optional(),
  experimentGroup: z.string().max(120).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const postPk = Number(params.id)
  if (!Number.isFinite(postPk) || postPk <= 0) {
    return apiError('VALIDATION_ERROR', 'Invalid post id', 400)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  const now = new Date().toISOString()
  const images = parsed.data.images
    ? parsed.data.images.slice(0, 4)
    : (parsed.data.imageUrl ? [parsed.data.imageUrl] : undefined)
  await db.update(socialMediaPosts).set({
    status: parsed.data.status,
    scheduledFor: parsed.data.scheduledFor ?? undefined,
    externalPostId: parsed.data.externalPostId ?? undefined,
    imageUrl: images ? (images[0] ?? null) : undefined,
    imageUrls: images ? JSON.stringify(images) : undefined,
    hypothesis: parsed.data.hypothesis ?? undefined,
    variantLabel: parsed.data.variantLabel ?? undefined,
    experimentGroup: parsed.data.experimentGroup ?? undefined,
    publishedAt: parsed.data.status === 'published' ? now : null,
    updatedAt: now,
  }).where(eq(socialMediaPosts.postPk, postPk))

  return apiResponse({ ok: true })
}
