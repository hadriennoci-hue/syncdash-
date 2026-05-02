import { NextRequest } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'

import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { platformMappings, products } from '@/lib/db/schema'
import { syncChannelAvailability } from '@/lib/functions/channel-sync'
import type { TriggeredBy } from '@/types/platform'

type Body = {
  skuFilter?: string[]
  triggeredBy?: TriggeredBy
  dryRun?: boolean
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = await req.json().catch(() => ({})) as Body
  const triggeredBy = body.triggeredBy ?? 'agent'
  const skuFilter = Array.isArray(body.skuFilter)
    ? body.skuFilter.map((sku) => String(sku).trim()).filter(Boolean)
    : null

  const mappedRows = await db
    .select({ sku: products.id })
    .from(products)
    .innerJoin(platformMappings, and(
      eq(platformMappings.productId, products.id),
      eq(platformMappings.platform, 'shopify_komputerzz'),
      eq(platformMappings.recordType, 'product'),
    ))
    .groupBy(products.id)

  const mappedSkus = mappedRows.map((row) => row.sku)
  const targetSkus = skuFilter?.length
    ? mappedSkus.filter((sku) => skuFilter.includes(sku))
    : mappedSkus

  if (body.dryRun) {
    return apiResponse({
      scanned: mappedSkus.length,
      targeted: targetSkus.length,
      triggeredBy,
      dryRun: true,
    })
  }

  if (targetSkus.length === 0) {
    return apiResponse({
      scanned: mappedSkus.length,
      targeted: 0,
      updated: 0,
      result: [],
    })
  }

  await db.update(products)
    .set({ pushedShopifyKomputerzz: '2push', updatedAt: new Date().toISOString() })
    .where(inArray(products.id, targetSkus))

  const result = await syncChannelAvailability(
    ['shopify_komputerzz'],
    triggeredBy,
    {
      skuFilter: targetSkus,
    }
  )

  return apiResponse({
    scanned: mappedSkus.length,
    targeted: targetSkus.length,
    updated: targetSkus.length,
    result,
  })
}
