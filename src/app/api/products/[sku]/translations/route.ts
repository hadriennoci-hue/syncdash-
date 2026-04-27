import { NextRequest } from 'next/server'
import { z } from 'zod'

import { verifyBearer } from '@/lib/auth/bearer'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import {
  deleteProductTranslation,
  getProductTranslations,
  upsertProductTranslations,
} from '@/lib/functions/product-translations'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { eq } from 'drizzle-orm'

const translationSchema = z.object({
  locale: z.string().trim().min(2).max(10).transform((value) => value.toLowerCase()),
  title: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  metaTitle: z.string().trim().min(1).nullable().optional(),
  metaDescription: z.string().trim().min(1).nullable().optional(),
}).refine(
  (value) => Boolean(value.title ?? value.description ?? value.metaTitle ?? value.metaDescription),
  'At least one translated field is required'
)

const putSchema = z.object({
  translations: z.array(translationSchema).min(1),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

const deleteSchema = z.object({
  locale: z.string().trim().min(2).max(10).transform((value) => value.toLowerCase()),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

async function ensureProductExists(sku: string): Promise<boolean> {
  const product = await db.query.products.findFirst({
    where: eq(products.id, sku),
    columns: { id: true },
  })
  return Boolean(product)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  if (!(await ensureProductExists(params.sku))) {
    return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)
  }

  const translations = await getProductTranslations(params.sku)
  return apiResponse(translations)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  if (!(await ensureProductExists(params.sku))) {
    return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)
  }

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const translations = await upsertProductTranslations(
    params.sku,
    parsed.data.translations,
    parsed.data.triggeredBy
  )

  return apiResponse(translations)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  if (!(await ensureProductExists(params.sku))) {
    return apiError('NOT_FOUND', `Product ${params.sku} not found`, 404)
  }

  const body = await req.json()
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await deleteProductTranslation(params.sku, parsed.data.locale, parsed.data.triggeredBy)
  return apiResponse({ deleted: true, locale: parsed.data.locale })
}
