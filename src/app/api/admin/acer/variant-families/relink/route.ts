import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'

import { verifyBearer } from '@/lib/auth/bearer'
import { db } from '@/lib/db/client'
import { productCategories, products } from '@/lib/db/schema'
import { autoLinkVariantFamily } from '@/lib/functions/variant-family'
import { apiError, apiResponse } from '@/lib/utils/api-response'

const TARGET_SLUGS = new Set(['laptops', 'work-laptops', 'gaming-laptops', 'input-devices'])

type RelinkResult = {
  sku: string
  linked: boolean
  reason?: string
  groupId?: string
  sourceSku?: string
  siblingSkus?: string[]
}

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }
  const dryRun = Boolean(body?.dryRun)

  const rows = await db.query.products.findMany({
    columns: { id: true, title: true, variantGroupId: true },
    with: {
      categories: { with: { category: { columns: { slug: true } } } },
      warehouseStock: { columns: { warehouseId: true, sourceUrl: true, sourceName: true } },
    },
  })

  const candidates = rows.filter((row) => {
    const slugs = new Set(
      row.categories
        .map((c) => c.category?.slug ?? null)
        .filter((slug): slug is string => !!slug)
    )
    if (![...TARGET_SLUGS].some((slug) => slugs.has(slug))) return false
    return row.warehouseStock.some((ws) => ws.warehouseId === 'acer_store')
  })

  const results: RelinkResult[] = []
  for (const candidate of candidates.sort((a, b) => a.id.localeCompare(b.id))) {
    if (dryRun) {
      results.push({ sku: candidate.id, linked: false, reason: 'dry_run' })
      continue
    }
    const result = await autoLinkVariantFamily(candidate.id, 'agent')
    results.push({ sku: candidate.id, ...result })
  }

  const linked = results.filter((result) => result.linked)
  const missed = results.filter((result) => !result.linked)
  const missedReasons = missed.reduce<Record<string, number>>((acc, item) => {
    const key = item.reason ?? 'unknown'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  return apiResponse({
    dryRun,
    candidates: candidates.length,
    linked: linked.length,
    missed: missed.length,
    missedReasons,
    results,
  })
}
