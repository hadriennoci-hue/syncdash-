import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import type { AttributeBrand, AttributeCollection } from '@/lib/constants/product-attribute-options'
import { getRuntimeAttributeOptions, upsertRuntimeAttributeOptions } from '@/lib/functions/attribute-options'

const querySchema = z.object({
  collection: z.enum(['laptops', 'monitor']).optional(),
  brand: z.enum(['acer', 'predator']).optional(),
})

const putSchema = z.object({
  collection: z.enum(['laptops', 'monitor']),
  key: z.string().trim().min(1).max(100),
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(300),
  mode: z.enum(['append', 'replace']).default('append'),
  brand: z.enum(['acer', 'predator']).optional(),
})

export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({
    collection: searchParams.get('collection') ?? undefined,
    brand: searchParams.get('brand') ?? undefined,
  })
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  const { collection, brand } = parsed.data
  if (!collection) {
    const laptops = await getRuntimeAttributeOptions('laptops', brand as AttributeBrand | undefined)
    const monitor = await getRuntimeAttributeOptions('monitor', brand as AttributeBrand | undefined)
    return apiResponse({
      collections: {
        laptops,
        monitor,
      },
      filters: { brand: brand ?? null },
    })
  }

  const attributes = await getRuntimeAttributeOptions(
    collection as AttributeCollection,
    brand as AttributeBrand | undefined
  )

  return apiResponse({
    collection,
    brand: brand ?? null,
    attributes,
  })
}

export async function PUT(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return apiError('VALIDATION_ERROR', parsed.error.message, 400)

  await upsertRuntimeAttributeOptions({
    collection: parsed.data.collection as AttributeCollection,
    key: parsed.data.key,
    values: parsed.data.values,
    mode: parsed.data.mode,
  })

  const attributes = await getRuntimeAttributeOptions(
    parsed.data.collection as AttributeCollection,
    parsed.data.brand as AttributeBrand | undefined
  )

  return apiResponse({
    collection: parsed.data.collection,
    brand: parsed.data.brand ?? null,
    updatedKey: parsed.data.key.trim().toLowerCase(),
    mode: parsed.data.mode,
    attributes,
  })
}
