import * as fs from 'node:fs'
import * as path from 'node:path'

type Locale = 'fr' | 'de' | 'es' | 'it'

interface ProductListRow {
  id: string
  title: string
  status: string
  hasDescription?: boolean
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
    description: string | null
    metaDescription: string | null
    acerStoreSourceUrl: string | null
    translations: Array<{
      locale: string
      title: string | null
      description: string | null
      metaDescription: string | null
    }>
  }
}

interface ProductCoverageRow {
  sku: string
  title: string
  hasSourceTitle: boolean
  hasSourceDescription: boolean
  hasSourceMetaDescription: boolean
  hasAcerSourceUrl: boolean
  completeLocales: string[]
  missingLocales: string[]
  sourceStrategy: 'acer-first' | 'ai-only' | 'blocked'
}

interface Summary {
  generatedAt: string
  statusFilter: string
  totalProducts: number
  productsFullyTranslated: number
  productsNeedingWork: number
  withAcerSourceUrl: number
  aiFallbackLikely: number
  blockedMissingEnglish: number
  localeCoverage: Record<Locale, { complete: number; missing: number }>
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=')
    return [key, rest.join('=')]
  })
)

const statusFilter = args.get('--status')?.trim() || 'active'
const perPage = Math.max(1, Number(args.get('--perPage') || '1000'))
const concurrency = Math.max(1, Math.min(16, Number(args.get('--concurrency') || '8')))
const targetLocales: Locale[] = ['fr', 'de', 'es', 'it']

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

  return rows
}

async function getProductDetail(sku: string): Promise<ProductDetailResponse['data']> {
  const result = await apiFetchJson<ProductDetailResponse>(`${BASE_URL}/api/products/${encodeURIComponent(sku)}`)
  return result.data
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
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

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

function classify(detail: ProductDetailResponse['data']): ProductCoverageRow {
  const translationMap = new Map(detail.translations.map((translation) => [translation.locale.toLowerCase(), translation]))
  const completeLocales = targetLocales.filter((locale) => {
    const row = translationMap.get(locale)
    return !!normalizeText(row?.title) && !!normalizeText(row?.description) && !!normalizeText(row?.metaDescription)
  })
  const missingLocales = targetLocales.filter((locale) => !completeLocales.includes(locale))
  const hasSourceTitle = !!normalizeText(detail.title)
  const hasSourceDescription = !!normalizeText(detail.description)
  const hasSourceMetaDescription = !!normalizeText(detail.metaDescription)
  const hasAcerSourceUrl = !!normalizeText(detail.acerStoreSourceUrl)

  let sourceStrategy: ProductCoverageRow['sourceStrategy'] = 'blocked'
  if (hasSourceTitle && hasSourceDescription) {
    sourceStrategy = hasAcerSourceUrl ? 'acer-first' : 'ai-only'
  }

  return {
    sku: detail.id,
    title: detail.title,
    hasSourceTitle,
    hasSourceDescription,
    hasSourceMetaDescription,
    hasAcerSourceUrl,
    completeLocales,
    missingLocales,
    sourceStrategy,
  }
}

function buildSummary(rows: ProductCoverageRow[]): Summary {
  const localeCoverage = Object.fromEntries(
    targetLocales.map((locale) => [locale, {
      complete: rows.filter((row) => row.completeLocales.includes(locale)).length,
      missing: rows.filter((row) => !row.completeLocales.includes(locale)).length,
    }])
  ) as Summary['localeCoverage']

  return {
    generatedAt: new Date().toISOString(),
    statusFilter,
    totalProducts: rows.length,
    productsFullyTranslated: rows.filter((row) => row.missingLocales.length === 0).length,
    productsNeedingWork: rows.filter((row) => row.missingLocales.length > 0).length,
    withAcerSourceUrl: rows.filter((row) => row.hasAcerSourceUrl).length,
    aiFallbackLikely: rows.filter((row) => row.sourceStrategy === 'ai-only').length,
    blockedMissingEnglish: rows.filter((row) => row.sourceStrategy === 'blocked').length,
    localeCoverage,
  }
}

function toReport(summary: Summary, rows: ProductCoverageRow[]): string {
  const blocked = rows.filter((row) => row.sourceStrategy === 'blocked')
  const aiOnly = rows.filter((row) => row.sourceStrategy === 'ai-only')
  const partial = rows.filter((row) => row.missingLocales.length > 0).slice(0, 50)

  const lines: string[] = []
  lines.push(`# Translation Coverage Report`)
  lines.push(``)
  lines.push(`Generated: ${summary.generatedAt}`)
  lines.push(`Status filter: ${summary.statusFilter}`)
  lines.push(`Total products: ${summary.totalProducts}`)
  lines.push(`Fully translated (${targetLocales.join('/')}): ${summary.productsFullyTranslated}`)
  lines.push(`Need work: ${summary.productsNeedingWork}`)
  lines.push(`Acer source URL present: ${summary.withAcerSourceUrl}`)
  lines.push(`Likely AI fallback only: ${summary.aiFallbackLikely}`)
  lines.push(`Blocked by missing English source: ${summary.blockedMissingEnglish}`)
  lines.push(``)
  lines.push(`## Locale coverage`)
  for (const locale of targetLocales) {
    lines.push(`- ${locale}: ${summary.localeCoverage[locale].complete} complete, ${summary.localeCoverage[locale].missing} missing`)
  }
  lines.push(``)
  lines.push(`## First 50 products still needing work`)
  for (const row of partial) {
    lines.push(`- ${row.sku} | missing: ${row.missingLocales.join(', ')} | strategy: ${row.sourceStrategy} | Acer source: ${row.hasAcerSourceUrl ? 'yes' : 'no'}`)
  }
  lines.push(``)
  lines.push(`## First 25 blocked products`)
  for (const row of blocked.slice(0, 25)) {
    lines.push(`- ${row.sku} | title: ${row.hasSourceTitle ? 'yes' : 'no'} | description: ${row.hasSourceDescription ? 'yes' : 'no'}`)
  }
  lines.push(``)
  lines.push(`## First 25 AI-only products`)
  for (const row of aiOnly.slice(0, 25)) {
    lines.push(`- ${row.sku} | ${row.title}`)
  }
  lines.push(``)
  return lines.join('\n')
}

async function main(): Promise<void> {
  const products = await getAllProducts()
  const rows = await mapLimit(products, concurrency, async (product) => classify(await getProductDetail(product.id)))
  const summary = buildSummary(rows)

  const reportsDir = path.join(process.cwd(), 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(reportsDir, `translation-coverage-${stamp}.json`)
  const mdPath = path.join(reportsDir, `translation-coverage-${stamp}.md`)

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2))
  fs.writeFileSync(mdPath, toReport(summary, rows))

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
