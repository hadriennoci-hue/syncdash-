import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import {
  getAttributeOptions,
  type AttributeBrand,
  type AttributeCollection,
} from '@/lib/constants/product-attribute-options'

const querySchema = z.object({
  collection: z.enum(['laptops', 'monitor']).optional(),
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
    return apiResponse({
      collections: {
        laptops: getAttributeOptions('laptops', brand as AttributeBrand | undefined),
        monitor: getAttributeOptions('monitor', brand as AttributeBrand | undefined),
      },
      filters: { brand: brand ?? null },
    })
  }

  return apiResponse({
    collection,
    brand: brand ?? null,
    attributes: getAttributeOptions(
      collection as AttributeCollection,
      brand as AttributeBrand | undefined
    ),
  })
}
