import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { socialMediaAccounts, socialMediaPosts } from '@/lib/db/schema'

const patchSchema = z.object({
  accountId: z.string().min(1).optional(),
  content: z.string().min(1).max(500).optional(),
  status: z.enum(['suggested', 'validated', 'canceled', 'published']).optional(),
  scheduledFor: z.string().datetime().optional(),
  externalPostId: z.string().optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).max(4).optional(),
  hypothesis: z.string().max(500).optional(),
  variantLabel: z.string().max(120).optional(),
  experimentGroup: z.string().max(120).optional(),
  quoteTweetId: z.string().regex(/^\d+$/).nullable().optional(),
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
  if (Object.keys(parsed.data).length === 0) {
    return apiError('VALIDATION_ERROR', 'No editable field provided', 400)
  }

  const now = new Date().toISOString()
  if (parsed.data.accountId) {
    const account = await db.query.socialMediaAccounts.findFirst({
      where: eq(socialMediaAccounts.id, parsed.data.accountId),
      columns: { id: true },
    })
    if (!account) {
      return apiError('NOT_FOUND', `social account ${parsed.data.accountId} not found`, 404)
    }
  }
  const images = parsed.data.images
    ? parsed.data.images.slice(0, 4)
    : (parsed.data.imageUrl ? [parsed.data.imageUrl] : undefined)
  await db.update(socialMediaPosts).set({
    accountId: parsed.data.accountId ?? undefined,
    content: parsed.data.content ?? undefined,
    status: parsed.data.status,
    scheduledFor: parsed.data.scheduledFor ?? undefined,
    externalPostId: parsed.data.externalPostId ?? undefined,
    imageUrl: images ? (images[0] ?? null) : undefined,
    imageUrls: images ? JSON.stringify(images) : undefined,
    hypothesis: parsed.data.hypothesis ?? undefined,
    variantLabel: parsed.data.variantLabel ?? undefined,
    experimentGroup: parsed.data.experimentGroup ?? undefined,
    quoteTweetId: parsed.data.quoteTweetId !== undefined ? parsed.data.quoteTweetId : undefined,
    publishedAt: parsed.data.status === undefined ? undefined : (parsed.data.status === 'published' ? now : null),
    updatedAt: now,
  }).where(eq(socialMediaPosts.postPk, postPk))

  return apiResponse({ ok: true })
}
