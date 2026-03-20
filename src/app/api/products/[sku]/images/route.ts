import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { setProductImages, addProductImages, deleteProductImages } from '@/lib/functions/images'
import type { Platform } from '@/types/platform'


const imageSchema = z.object({
  images: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: z.string().url(), alt: z.string().optional() }),
    z.object({ type: z.literal('file'), data: z.any(), filename: z.string(), mimeType: z.string() }),
  ])),
  platforms:   z.array(z.string()).default([]),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

const deleteSchema = z.object({
  platforms:   z.array(z.string()).default([]),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

// PUT — replace all images
export async function PUT(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = imageSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await setProductImages(
    params.sku,
    parsed.data.images as never,
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}

// POST — add images
export async function POST(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = imageSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await addProductImages(
    params.sku,
    parsed.data.images as never,
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}

// DELETE — remove all images
export async function DELETE(req: NextRequest, { params }: { params: { sku: string } }) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const results = await deleteProductImages(
    params.sku,
    parsed.data.platforms as Platform[],
    parsed.data.triggeredBy
  )
  return apiResponse(results)
}
