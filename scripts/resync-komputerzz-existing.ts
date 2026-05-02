type ProductListItem = {
  id: string
  platforms: Record<string, { status: string; price: number | null; compareAt: number | null } | undefined>
}

type ProductDetail = {
  id: string
  pushStatus?: Record<string, string | undefined>
  platforms: Record<string, { platformId: string; recordType: string; syncStatus: string } | undefined>
}

type ResyncResponse = {
  scanned?: number
  targeted?: number
  updated?: number
  dryRun?: boolean
  result?: unknown
}

const BASE_URL = process.env.CLEANUP_BASE_URL?.trim() || 'https://wizhard.store'
const TOKEN = process.env.AGENT_BEARER_TOKEN?.trim()
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID?.trim()
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET?.trim()
const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const BATCH_SIZE = 5
const DETAIL_BATCH_SIZE = 20
const skipArg = process.argv.find((arg) => arg.startsWith('--skip='))
const SKIP = skipArg ? Math.max(0, Number.parseInt(skipArg.slice('--skip='.length), 10) || 0) : 0

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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  const payload = await res.json() as { data: T }
  return payload.data
}

async function fetchAllProductIds(): Promise<ProductListItem[]> {
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

async function mapBatches<T, R>(
  values: T[],
  batchSize: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize)
    const results = await Promise.all(batch.map((value) => mapper(value)))
    out.push(...results)
  }
  return out
}

function isRetriableBatchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /ECONNRESET|fetch failed|ETIMEDOUT|timeout/i.test(err.message)
}

async function syncKomputerzzBatch(batch: string[], label: string): Promise<number> {
  if (batch.length === 0) return 0

  try {
    const response = await apiPost<ResyncResponse>('/api/admin/shopify/komputerzz/resync-existing', {
      skuFilter: batch,
      triggeredBy: 'agent',
    })
    console.log(JSON.stringify({
      batch: label,
      batchSize: batch.length,
      scanned: response.scanned,
      targeted: response.targeted,
      updated: response.updated,
    }, null, 2))
    return batch.length
  } catch (err) {
    if (batch.length === 1 || !isRetriableBatchError(err)) {
      throw err
    }

    const left = batch.slice(0, Math.ceil(batch.length / 2))
    const right = batch.slice(Math.ceil(batch.length / 2))
    console.log(`batch ${label} failed, splitting into ${left.length} + ${right.length}`)
    const leftDone = await syncKomputerzzBatch(left, `${label}a`)
    const rightDone = await syncKomputerzzBatch(right, `${label}b`)
    return leftDone + rightDone
  }
}

async function main() {
  const products = await fetchAllProductIds()
  const roughCandidates = products.filter((product) => product.platforms?.shopify_komputerzz?.status !== 'missing')

  const scannedRows = await mapBatches(roughCandidates, DETAIL_BATCH_SIZE, async (product) => {
    const detail = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(product.id)}`)
    const mapping = detail.platforms?.shopify_komputerzz
    const isExistingShopifyProduct = !!mapping && mapping.recordType === 'product' && !!mapping.platformId
    return {
      sku: product.id,
      existingShopifyProduct: isExistingShopifyProduct,
      queuedButUnmapped: !isExistingShopifyProduct && detail.pushStatus?.shopify_komputerzz === '2push',
    }
  })

  const existingShopifySkus = scannedRows.filter((row) => row.existingShopifyProduct).map((row) => row.sku)
  const queuedButUnmappedSkus = scannedRows.filter((row) => row.queuedButUnmapped).map((row) => row.sku)

  console.log(JSON.stringify({
    scanned: products.length,
    roughCandidates: roughCandidates.length,
    existingShopifySkus: existingShopifySkus.length,
    queuedButUnmappedSkus: queuedButUnmappedSkus.length,
    skip: SKIP,
    dryRun: DRY_RUN,
  }, null, 2))

  if (DRY_RUN) return

  const resyncSkus = existingShopifySkus.slice(SKIP)
  const totalBatches = Math.max(1, Math.ceil(resyncSkus.length / BATCH_SIZE))
  let pushedSkus = 0
  for (let i = 0; i < resyncSkus.length; i += BATCH_SIZE) {
    const batch = resyncSkus.slice(i, i + BATCH_SIZE)
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1
    console.log(`resyncing batch ${batchIndex}/${totalBatches} (${batch.length} SKUs)`)
    pushedSkus += await syncKomputerzzBatch(batch, `${batchIndex}/${totalBatches}`)
  }

  console.log(JSON.stringify({
    pushedBatches: totalBatches,
    pushedSkus,
    leftQueuedForClassicPush: queuedButUnmappedSkus.length,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
