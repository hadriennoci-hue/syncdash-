import * as fs from 'node:fs'
import * as path from 'node:path'
import FirecrawlApp from '@mendable/firecrawl-js'

type Locale = 'fr' | 'de' | 'es' | 'it'

interface ProductListRow {
  id: string
  title: string
  status: string
}

interface ProductListResponse {
  data: ProductListRow[]
  meta?: {
    total?: number
    page?: number
    perPage?: number
    totalPages?: number
  }
}

interface ProductDetailResponse {
  data: {
    id: string
    title: string
    acerStoreSourceUrl: string | null
  }
}

interface SearchExtract {
  productUrl?: string | null
}

interface ValidationExtract {
  sku?: string | null
  title?: string | null
}

interface LocaleDiscovery {
  locale: Locale
  status: 'found' | 'missing' | 'error'
  url: string | null
  method: 'direct' | 'search' | null
  error: string | null
}

interface ProductDiscoveryRow {
  sku: string
  title: string
  acerStoreSourceUrl: string | null
  locales: Record<Locale, LocaleDiscovery>
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=')
    return [key, rest.join('=')]
  })
)

const statusFilter = args.get('--status')?.trim() || 'active'
const perPage = Math.max(1, Number(args.get('--perPage') || '1000'))
const concurrency = Math.max(1, Math.min(8, Number(args.get('--concurrency') || '3')))
const limit = Number(args.get('--limit') || '0')

const targetLocales: Locale[] = ['fr', 'de', 'es', 'it']
const localeStoreMap: Record<Locale, string> = {
  fr: 'fr-fr',
  de: 'de-de',
  es: 'es-es',
  it: 'it-it',
}

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, '.dev.vars')
    if (fs.existsSync(file)) {
      const vars: Record<string, string> = {}
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line || /^\s*#/.test(line)) continue
        const idx = line.indexOf('=')
        if (idx < 1) continue
        const key = line.slice(0, idx).trim()
        let value = line.slice(idx + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        vars[key] = value
      }
      return vars
    }
    dir = path.dirname(dir)
  }
  return {}
}

const vars = readDevVars()
const BASE_URL = vars.WIZHARD_URL ?? 'https://wizhard.store'
const FIRECRAWL_API_KEY = vars.FIRECRAWL_API_KEY ?? process.env.FIRECRAWL_API_KEY ?? ''

if (!FIRECRAWL_API_KEY) {
  throw new Error('FIRECRAWL_API_KEY missing')
}

function getApiHeaders(): Record<string, string> {
  const token = vars.AGENT_BEARER_TOKEN ?? process.env.AGENT_BEARER_TOKEN ?? ''
  const clientId = vars.CF_ACCESS_CLIENT_ID ?? vars.CLOUDFLARE_ACCESS_CLIENT_ID ?? process.env.CF_ACCESS_CLIENT_ID ?? ''
  const clientSecret = vars.CF_ACCESS_CLIENT_SECRET ?? vars.CLOUDFLARE_ACCESS_CLIENT_SECRET ?? process.env.CF_ACCESS_CLIENT_SECRET ?? ''
  return {
    Authorization: `Bearer ${token}`,
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
  }
}

function normalizeText(input: string | null | undefined): string {
  return (input ?? '').trim()
}

async function apiFetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getApiHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function getAllProducts(): Promise<ProductListRow[]> {
  const rows: ProductListRow[] = []
  let page = 1

  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
      status: statusFilter,
    })
    const result = await apiFetchJson<ProductListResponse>(`${BASE_URL}/api/products?${query.toString()}`)
    rows.push(...result.data)
    const totalPages = result.meta?.totalPages ?? page
    if (page >= totalPages) break
    page += 1
  }

  return limit > 0 ? rows.slice(0, limit) : rows
}

async function getProductDetail(sku: string): Promise<ProductDetailResponse['data']> {
  const result = await apiFetchJson<ProductDetailResponse>(`${BASE_URL}/api/products/${encodeURIComponent(sku)}`)
  return result.data
}

async function mapLimit<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function run(): Promise<void> {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await worker(items[current], current)
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, () => run()))
  return results
}

const firecrawl = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY })

async function validateProductUrl(url: string, sku: string): Promise<boolean> {
  const result = await firecrawl.scrapeUrl(url, {
    formats: ['extract'],
    extract: {
      prompt: `Check whether this Acer Store page is the product page for SKU ${sku}. Return the exact SKU and title if present, otherwise return nulls.`,
      schema: {
        type: 'object',
        properties: {
          sku: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
        },
      } as never,
    },
  })

  if (!result.success) return false
  const extract = (result as { extract?: ValidationExtract }).extract
  return normalizeText(extract?.sku).toUpperCase() === sku.toUpperCase()
}

async function searchLocaleUrl(sku: string, locale: Locale): Promise<string | null> {
  const localeStore = localeStoreMap[locale]
  const q = `site:store.acer.com/${localeStore} "${sku}" Acer`
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=${locale}&gl=${locale.toUpperCase()}`
  const result = await firecrawl.scrapeUrl(googleUrl, {
    formats: ['extract'],
    extract: {
      prompt:
        `Find the best Acer Store product URL for SKU ${sku} on locale ${localeStore}. ` +
        'Return only a product page URL on store.acer.com for that locale. If nothing matches, return null.',
      schema: {
        type: 'object',
        properties: {
          productUrl: { type: ['string', 'null'] },
        },
      } as never,
    },
  })

  if (!result.success) return null
  const extract = (result as { extract?: SearchExtract }).extract
  const url = normalizeText(extract?.productUrl)
  if (!url || !url.includes(`store.acer.com/${localeStore}`)) return null
  return url
}

async function discoverLocaleForProduct(
  sku: string,
  acerStoreSourceUrl: string | null,
  locale: Locale
): Promise<LocaleDiscovery> {
  try {
    const localeStore = localeStoreMap[locale]
    const directCandidate = acerStoreSourceUrl?.replace(/store\.acer\.com\/[a-z]{2}-[a-z]{2}\//i, `store.acer.com/${localeStore}/`) ?? null

    if (directCandidate && await validateProductUrl(directCandidate, sku)) {
      return {
        locale,
        status: 'found',
        url: directCandidate,
        method: 'direct',
        error: null,
      }
    }

    const searchedUrl = await searchLocaleUrl(sku, locale)
    if (searchedUrl && await validateProductUrl(searchedUrl, sku)) {
      return {
        locale,
        status: 'found',
        url: searchedUrl,
        method: 'search',
        error: null,
      }
    }

    return {
      locale,
      status: 'missing',
      url: null,
      method: null,
      error: null,
    }
  } catch (error) {
    return {
      locale,
      status: 'error',
      url: null,
      method: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function discoverProduct(product: ProductListRow): Promise<ProductDiscoveryRow> {
  const detail = await getProductDetail(product.id)
  const localePairs = await mapLimit(targetLocales, 2, async (locale) => [
    locale,
    await discoverLocaleForProduct(detail.id, detail.acerStoreSourceUrl, locale),
  ] as const)

  return {
    sku: detail.id,
    title: detail.title,
    acerStoreSourceUrl: detail.acerStoreSourceUrl,
    locales: Object.fromEntries(localePairs) as Record<Locale, LocaleDiscovery>,
  }
}

function buildSummary(rows: ProductDiscoveryRow[]) {
  const localeSummary = Object.fromEntries(targetLocales.map((locale) => [
    locale,
    {
      found: rows.filter((row) => row.locales[locale].status === 'found').length,
      missing: rows.filter((row) => row.locales[locale].status === 'missing').length,
      errors: rows.filter((row) => row.locales[locale].status === 'error').length,
      direct: rows.filter((row) => row.locales[locale].method === 'direct').length,
      search: rows.filter((row) => row.locales[locale].method === 'search').length,
    },
  ]))

  return {
    generatedAt: new Date().toISOString(),
    statusFilter,
    totalProducts: rows.length,
    localeSummary,
    fullyCoveredByAcer: rows.filter((row) => targetLocales.every((locale) => row.locales[locale].status === 'found')).length,
    needingAiFallbackForAtLeastOneLocale: rows.filter((row) => targetLocales.some((locale) => row.locales[locale].status !== 'found')).length,
  }
}

function markdownReport(summary: ReturnType<typeof buildSummary>, rows: ProductDiscoveryRow[]): string {
  const lines: string[] = []
  lines.push('# Translation Source Discovery Report')
  lines.push('')
  lines.push(`Generated: ${summary.generatedAt}`)
  lines.push(`Status filter: ${summary.statusFilter}`)
  lines.push(`Total products: ${summary.totalProducts}`)
  lines.push(`Fully covered by Acer locale URLs: ${summary.fullyCoveredByAcer}`)
  lines.push(`Need AI fallback for at least one locale: ${summary.needingAiFallbackForAtLeastOneLocale}`)
  lines.push('')
  lines.push('## Locale summary')
  for (const locale of targetLocales) {
    const item = summary.localeSummary[locale]
    lines.push(`- ${locale}: found ${item.found}, missing ${item.missing}, errors ${item.errors}, direct ${item.direct}, search ${item.search}`)
  }
  lines.push('')
  lines.push('## First 50 products missing at least one locale Acer URL')
  for (const row of rows.filter((entry) => targetLocales.some((locale) => entry.locales[locale].status !== 'found')).slice(0, 50)) {
    const missing = targetLocales.filter((locale) => row.locales[locale].status !== 'found')
    lines.push(`- ${row.sku} | missing: ${missing.join(', ')} | source: ${row.acerStoreSourceUrl ?? 'none'}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const products = await getAllProducts()
  const rows = await mapLimit(products, concurrency, (product) => discoverProduct(product))
  const summary = buildSummary(rows)

  const reportsDir = path.join(process.cwd(), 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(reportsDir, `translation-source-discovery-${stamp}.json`)
  const mdPath = path.join(reportsDir, `translation-source-discovery-${stamp}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2))
  fs.writeFileSync(mdPath, markdownReport(summary, rows))

  console.log(JSON.stringify({
    summary,
    reportFiles: {
      json: jsonPath,
      markdown: mdPath,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
