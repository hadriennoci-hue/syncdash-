import { db } from '@/lib/db/client'
import { autoLinkVariantFamily } from '@/lib/functions/variant-family'

const TARGET_SLUGS = new Set(['laptops', 'work-laptops', 'gaming-laptops', 'input-devices'])

async function main() {
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

  console.log(`candidates=${candidates.length}`)

  const results: Array<{
    sku: string
    linked: boolean
    reason?: string
    groupId?: string
    sourceSku?: string
    siblingSkus?: string[]
  }> = []

  for (const candidate of candidates.sort((a, b) => a.id.localeCompare(b.id))) {
    const result = await autoLinkVariantFamily(candidate.id, 'agent')
    results.push({ sku: candidate.id, ...result })
    console.log(JSON.stringify({ sku: candidate.id, ...result }))
  }

  const linked = results.filter((result) => result.linked)
  const missed = results.filter((result) => !result.linked)
  const missedReasons = missed.reduce<Record<string, number>>((acc, item) => {
    const key = item.reason ?? 'unknown'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  console.log(JSON.stringify({
    linked: linked.length,
    missed: missed.length,
    missedReasons,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
