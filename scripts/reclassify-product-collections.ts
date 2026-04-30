import * as fs from 'fs'
import * as path from 'path'
import { inferCollection } from '@/lib/functions/collection-inference'

interface ProductListItem {
  id: string
}

interface ProductCategoryItem {
  id: string
  platform: string
  slug: string | null
  type?: string | null
  collectionType?: string | null
}

interface ProductDetail {
  id: string
  title: string
  prices: Record<string, { price: number | null } | undefined>
  acerStoreSourceName?: string | null
  acerStoreSourceUrl?: string | null
  collections: ProductCategoryItem[]
}

interface CategoryRow {
  id: string
  name: string
  slug: string | null
  platform: string
  collectionType: string
}

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      return Object.fromEntries(
        fs.readFileSync(candidate, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => [match[1], match[2].trim()])
      )
    }
    dir = path.dirname(dir)
  }
  return {}
}

const env = readDevVars()
const baseUrl = env.WIZHARD_URL ?? 'https://wizhard.store'
const bearer = process.env.AGENT_BEARER_TOKEN ?? env.AGENT_BEARER_TOKEN ?? ''
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
  }
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    out['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID
    out['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET
  }
  return { ...out, ...extra }
}

async function apiGet<T>(pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: headers() })
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${await res.text()}`)
  const json = await res.json() as { data: T }
  return json.data
}

async function apiPatch(pathname: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${pathname} -> ${res.status} ${await res.text()}`)
}

async function fetchAllProductIds(): Promise<string[]> {
  const out: string[] = []
  let page = 1
  const perPage = 500

  while (true) {
    const res = await fetch(`${baseUrl}/api/products?page=${page}&perPage=${perPage}`, { headers: headers() })
    if (!res.ok) throw new Error(`GET /api/products?page=${page} -> ${res.status} ${await res.text()}`)
    const json = await res.json() as { data: ProductListItem[]; meta?: { pagination?: { totalPages?: number } } }
    const rows = json.data ?? []
    out.push(...rows.map((row) => row.id))
    if (rows.length < perPage) break
    page += 1
  }

  return out
}

async function runConcurrent<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

async function main(): Promise<void> {
  if (!bearer) throw new Error('AGENT_BEARER_TOKEN missing')

  const categories = await apiGet<CategoryRow[]>('/api/categories?platform=shopify_tiktok')
  const categoryIdBySlug = new Map<string, string>()
  for (const category of categories) {
    if (category.slug) categoryIdBySlug.set(category.slug, category.id)
  }

  const productIds = await fetchAllProductIds()
  let checked = 0
  let changed = 0

  await runConcurrent(productIds, 8, async (sku) => {
    const detail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(sku)}`)
    const inferredSlug = inferCollection(detail.title)
    const desired = inferredSlug ? { slug: inferredSlug, reason: 'title_inference' } : null

    checked += 1
    if (!desired) return

    const targetCategoryId = categoryIdBySlug.get(desired.slug)
    if (!targetCategoryId) throw new Error(`Missing shopify_tiktok category for slug ${desired.slug}`)

    const currentProductCategories = detail.collections.filter((item) => (item.collectionType ?? item.type) === 'product')
    const currentTiktokCategory = currentProductCategories.find((item) => item.platform === 'shopify_tiktok') ?? null
    const preservedNonProductCategories = detail.collections
      .filter((item) => (item.collectionType ?? item.type) !== 'product')
      .map((item) => item.id)

    const nextCategoryIds = [...preservedNonProductCategories, targetCategoryId]
    const alreadyCorrect = currentTiktokCategory?.id === targetCategoryId
      && currentProductCategories.length === 1

    if (alreadyCorrect) return

    await apiPatch(`/api/products/${encodeURIComponent(sku)}/local`, {
      fields: { categoryIds: nextCategoryIds },
      triggeredBy: 'agent',
    })
    changed += 1
    console.log(`[reclassify] ${sku}: ${currentTiktokCategory?.slug ?? 'none'} -> ${desired.slug} (${desired.reason})`)
  })

  console.log(`[reclassify] checked=${checked} changed=${changed}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
