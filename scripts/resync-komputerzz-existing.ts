import { cleanTextArtifacts } from '@/lib/utils/description'

type ProductListItem = {
  id: string
  title: string
  platforms: Record<string, { status: string; price: number | null; compareAt: number | null } | undefined>
}

type ProductDetail = {
  id: string
  platformId?: string | null
  title: string
  description: string | null
  metaDescription: string | null
  platforms: Record<string, { platformId: string; recordType: string; syncStatus: string } | undefined>
}

const BASE_URL = process.env.CLEANUP_BASE_URL?.trim() || 'https://wizhard.store'
const TOKEN = process.env.AGENT_BEARER_TOKEN?.trim()
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID?.trim()
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET?.trim()
const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')

if (!TOKEN) throw new Error('Missing AGENT_BEARER_TOKEN')
if (!CF_ACCESS_CLIENT_ID) throw new Error('Missing CF_ACCESS_CLIENT_ID')
if (!CF_ACCESS_CLIENT_SECRET) throw new Error('Missing CF_ACCESS_CLIENT_SECRET')

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`)
  const payload = await res.json() as { data: T }
  return payload.data
}

async function apiPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
}

async function apiPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`)
}

async function fetchAllProducts(): Promise<ProductListItem[]> {
  const out: ProductListItem[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await fetch(`${BASE_URL}/api/products?page=${page}&perPage=200`, { headers: HEADERS })
    if (!res.ok) throw new Error(`GET /api/products?page=${page} failed: ${res.status} ${await res.text()}`)
    const payload = await res.json() as { data: ProductListItem[]; meta?: { totalPages?: number } }
    out.push(...(payload.data ?? []))
    totalPages = payload.meta?.totalPages ?? page
    page += 1
  } while (page <= totalPages)
  return out
}

function clean(text: string | null | undefined): string | null {
  return cleanTextArtifacts(text)
}

async function main() {
  const products = await fetchAllProducts()

  const candidateSkus: string[] = []
  for (const product of products) {
    const detail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(product.id)}`)
    const mapping = detail.platforms?.shopify_komputerzz
    if (!mapping || mapping.recordType !== 'product' || !mapping.platformId) continue
    candidateSkus.push(product.id)
  }

  console.log(JSON.stringify({
    scanned: products.length,
    eligibleExistingShopifyProducts: candidateSkus.length,
    dryRun: DRY_RUN,
  }, null, 2))

  if (DRY_RUN) return

  let pushed = 0
  let failed = 0
  const errors: string[] = []

  for (const sku of candidateSkus) {
    try {
      const detail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(sku)}`)
      const title = clean(detail.title) ?? detail.title
      const description = clean(detail.description)
      const metaDescription = clean(detail.metaDescription)

      await apiPatch(`/api/products/${encodeURIComponent(sku)}/push-status`, {
        platform: 'shopify_komputerzz',
        status: '2push',
      })

      await apiPost('/api/sync/channel-availability', {
        platforms: ['shopify_komputerzz'],
        sku,
        triggeredBy: 'agent',
      })

      pushed += 1
      console.log(`✓ ${sku} resynced`)
      if (title !== detail.title || description !== detail.description || metaDescription !== detail.metaDescription) {
        console.log(`  cleaned base text before sync`)
      }
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${sku}: ${message}`)
      console.error(`✗ ${sku}: ${message}`)
    }
  }

  console.log(JSON.stringify({
    pushed,
    failed,
    errors,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
