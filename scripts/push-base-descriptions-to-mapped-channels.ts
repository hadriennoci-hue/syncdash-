import * as fs from 'node:fs'
import * as path from 'node:path'

import { CoincartConnector } from '@/lib/connectors/coincart'
import { ShopifyConnector } from '@/lib/connectors/shopify'

type Platform = 'coincart2' | 'shopify_komputerzz'

type ProductListItem = {
  id: string
  platforms?: Record<string, { status?: string | null } | undefined>
}

type ProductListResponse = {
  data: ProductListItem[]
  meta?: {
    totalPages?: number
  }
}

type ProductDetail = {
  id: string
  description: string | null
  platforms?: Record<string, {
    platformId: string
    recordType: string
    syncStatus: string
  } | undefined>
}

type ProductDetailResponse = {
  data: ProductDetail
}

const PAGE_SIZE = 200
const DETAIL_CONCURRENCY = 8
const RETRY_DELAYS_MS = [2000, 5000, 10000]

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, '.dev.vars')
    if (fs.existsSync(file)) {
      const vars: Record<string, string> = {}
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line || /^\s*#/.test(line)) continue
        const idx = line.indexOf('=')
        if (idx < 0) continue
        const key = line.slice(0, idx).trim()
        let value = line.slice(idx + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        if (key) vars[key] = value
      }
      return vars
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

function normalizeText(input: string | null | undefined): string | null {
  const value = (input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return value || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (/Coincart stale mapping|Coincart product not found by SKU/i.test(err.message)) return false
  return /(502|503|504|429)\b|bad gateway|fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message)
}

async function withRetry<T>(label: string, work: () => Promise<T>): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await work()
    } catch (err) {
      lastError = err
      if (!isRetriableError(err) || attempt === RETRY_DELAYS_MS.length) throw err
      const delay = RETRY_DELAYS_MS[attempt]
      console.log(`[retry] ${label} failed on attempt ${attempt + 1}; retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unknown retry failure for ${label}`)
}

function getApiHeaders(vars: Record<string, string>): Record<string, string> {
  const token = vars.AGENT_BEARER_TOKEN ?? process.env.AGENT_BEARER_TOKEN ?? ''
  const clientId =
    vars.CF_ACCESS_CLIENT_ID
    ?? vars.CLOUDFLARE_ACCESS_CLIENT_ID
    ?? process.env.CF_ACCESS_CLIENT_ID
    ?? process.env.CLOUDFLARE_ACCESS_CLIENT_ID
    ?? ''
  const clientSecret =
    vars.CF_ACCESS_CLIENT_SECRET
    ?? vars.CLOUDFLARE_ACCESS_CLIENT_SECRET
    ?? process.env.CF_ACCESS_CLIENT_SECRET
    ?? process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET
    ?? ''

  if (!token) throw new Error('Missing AGENT_BEARER_TOKEN')

  return {
    Authorization: `Bearer ${token}`,
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  }
}

async function apiFetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function fetchShopifyAccessToken(vars: Record<string, string>): Promise<string> {
  const shop = vars.SHOPIFY_KOMPUTERZZ_SHOP ?? process.env.SHOPIFY_KOMPUTERZZ_SHOP ?? ''
  const clientId = vars.SHOPIFY_KOMPUTERZZ_CLIENT_ID ?? process.env.SHOPIFY_KOMPUTERZZ_CLIENT_ID ?? ''
  const clientSecret = vars.SHOPIFY_KOMPUTERZZ_CLIENT_SECRET ?? process.env.SHOPIFY_KOMPUTERZZ_CLIENT_SECRET ?? ''

  if (!shop || !clientId || !clientSecret) {
    throw new Error('Missing Shopify Komputerzz OAuth credentials')
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })

  if (!res.ok) throw new Error(`Shopify OAuth ${res.status}: ${await res.text()}`)
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw new Error('Shopify OAuth returned no access_token')
  return json.access_token
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (true) {
      const current = cursor
      cursor += 1
      if (current >= items.length) return
      results[current] = await worker(items[current], current)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

async function getAllProducts(baseUrl: string, headers: Record<string, string>): Promise<ProductListItem[]> {
  const rows: ProductListItem[] = []
  let page = 1
  let totalPages = 1

  do {
    const result = await apiFetchJson<ProductListResponse>(
      `${baseUrl}/api/products?page=${page}&perPage=${PAGE_SIZE}`,
      headers,
    )
    rows.push(...(result.data ?? []))
    totalPages = result.meta?.totalPages ?? page
    page += 1
  } while (page <= totalPages)

  return rows
}

async function getProductDetail(baseUrl: string, headers: Record<string, string>, sku: string): Promise<ProductDetail> {
  const result = await apiFetchJson<ProductDetailResponse>(
    `${baseUrl}/api/products/${encodeURIComponent(sku)}`,
    headers,
  )
  return result.data
}

async function main(): Promise<void> {
  const vars = readDevVars()
  const baseUrl = vars.WIZHARD_URL ?? process.env.WIZHARD_URL ?? 'https://wizhard.store'
  const headers = getApiHeaders(vars)
  const dryRun = process.argv.includes('--dry-run')
  const skuList = new Set(
    (process.argv.find((arg) => arg.startsWith('--sku-list='))?.split('=')[1] ?? '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  )
  const platforms = new Set<Platform>(
    ((process.argv.find((arg) => arg.startsWith('--platforms='))?.split('=')[1] ?? 'coincart2,shopify_komputerzz')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as Platform[]),
  )

  const allProducts = await getAllProducts(baseUrl, headers)
  const roughCandidates = allProducts.filter((product) => (
    (platforms.has('coincart2') && product.platforms?.coincart2?.status !== 'missing')
    || (platforms.has('shopify_komputerzz') && product.platforms?.shopify_komputerzz?.status !== 'missing')
  ))

  const details = await mapLimit(roughCandidates, DETAIL_CONCURRENCY, (product) => getProductDetail(baseUrl, headers, product.id))

  const targets = details
    .map((detail) => {
      if (skuList.size > 0 && !skuList.has(detail.id.toUpperCase())) return null
      const description = normalizeText(detail.description)
      if (!description) return null

      const mappedPlatforms: Array<{ platform: Platform; platformId: string }> = []
      if (platforms.has('coincart2')) {
        const mapping = detail.platforms?.coincart2
        if (mapping?.platformId && mapping.recordType === 'product') {
          mappedPlatforms.push({ platform: 'coincart2', platformId: mapping.platformId })
        }
      }
      if (platforms.has('shopify_komputerzz')) {
        const mapping = detail.platforms?.shopify_komputerzz
        if (mapping?.platformId && mapping.recordType === 'product') {
          mappedPlatforms.push({ platform: 'shopify_komputerzz', platformId: mapping.platformId })
        }
      }
      if (mappedPlatforms.length === 0) return null

      return {
        sku: detail.id,
        description,
        mappedPlatforms,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  console.log(JSON.stringify({
    scanned: allProducts.length,
    roughCandidates: roughCandidates.length,
    targets: targets.length,
    platforms: [...platforms],
    dryRun,
  }, null, 2))

  if (dryRun || targets.length === 0) return

  const coincart = platforms.has('coincart2')
    ? new CoincartConnector(
      vars.COINCART_URL ?? process.env.COINCART_URL ?? '',
      vars.COINCART_KEY ?? process.env.COINCART_KEY ?? '',
      vars.COINCART_SECRET ?? process.env.COINCART_SECRET ?? '',
      process.env.COINCART_API_URL,
    )
    : null
  const shopify = platforms.has('shopify_komputerzz')
    ? new ShopifyConnector(
      vars.SHOPIFY_KOMPUTERZZ_SHOP ?? process.env.SHOPIFY_KOMPUTERZZ_SHOP ?? '',
      await fetchShopifyAccessToken(vars),
      vars.SHOPIFY_KOMPUTERZZ_LOCATION_ID ?? process.env.SHOPIFY_KOMPUTERZZ_LOCATION_ID,
    )
    : null

  let updates = 0
  const errors: string[] = []
  for (const [index, target] of targets.entries()) {
    console.log(`[push] ${index + 1}/${targets.length} ${target.sku}`)
    for (const mapping of target.mappedPlatforms) {
      try {
        await withRetry(`${target.sku} ${mapping.platform}`, async () => {
          if (mapping.platform === 'coincart2') {
            if (!coincart) throw new Error('Coincart connector not initialized')
            try {
              await coincart.updateProduct(mapping.platformId, { description: target.description })
            } catch (error) {
              if (!(error instanceof Error) || !/Coincart error: 404\b/i.test(error.message)) throw error
              const recoveredId = await coincart.findProductIdBySku(target.sku)
              if (!recoveredId) throw new Error(`Coincart product not found by SKU after stale mapping 404`)
              try {
                await coincart.updateProduct(recoveredId, { description: target.description })
              } catch (recoveredError) {
                if (recoveredError instanceof Error && /Coincart error: 404\b/i.test(recoveredError.message)) {
                  throw new Error(`Coincart stale mapping unresolved after SKU recovery`)
                }
                throw recoveredError
              }
            }
          } else {
            if (!shopify) throw new Error('Shopify connector not initialized')
            await shopify.updateProduct(mapping.platformId, { description: target.description })
          }
        })
        updates += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${target.sku} ${mapping.platform}: ${message}`)
        console.log(`  [error] ${target.sku} ${mapping.platform}: ${message}`)
      }
    }
  }

  console.log(JSON.stringify({ pushedTargets: targets.length, platformUpdates: updates, errors }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
