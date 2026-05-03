import * as fs from 'node:fs'
import * as path from 'node:path'

import { ShopifyConnector } from '@/lib/connectors/shopify'

type Locale = 'fr' | 'de' | 'es' | 'it'

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
  title: string
  metaDescription: string | null
  platforms?: Record<string, {
    platformId: string
    recordType: string
    syncStatus: string
  } | undefined>
  translations: Array<{
    locale: string
    metaTitle: string | null
    metaDescription: string | null
  }>
}

type ProductDetailResponse = {
  data: ProductDetail
}

type VerifyResult = {
  sku: string
  productId: string
  baseMatches: boolean
  localeChecks: Array<{
    locale: string
    metaTitleMatches: boolean
    metaDescriptionMatches: boolean
  }>
}

const TARGET_LOCALES: Locale[] = ['fr', 'de', 'es', 'it']
const PAGE_SIZE = 200
const DETAIL_CONCURRENCY = 8
const PUSH_SAMPLE_COUNT = 5
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
  return /Shopify (REST|GraphQL) error: (502|503|504)\b|bad gateway|fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message)
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

  if (!res.ok) {
    throw new Error(`Shopify OAuth ${res.status}: ${await res.text()}`)
  }

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
  const baseUrl = vars.WIZHARD_URL ?? process.env.CLEANUP_BASE_URL ?? 'https://wizhard.store'
  const headers = getApiHeaders(vars)
  const dryRun = process.argv.includes('--dry-run')
  const skipArg = process.argv.find((arg) => arg.startsWith('--skip='))
  const skip = skipArg ? Math.max(0, Number.parseInt(skipArg.slice('--skip='.length), 10) || 0) : 0

  const allProducts = await getAllProducts(baseUrl, headers)
  const roughCandidates = allProducts.filter((product) => product.platforms?.shopify_komputerzz?.status !== 'missing')
  const details = await mapLimit(roughCandidates, DETAIL_CONCURRENCY, (product) => getProductDetail(baseUrl, headers, product.id))

  const mappedProducts = details
    .map((detail) => {
      const mapping = detail.platforms?.shopify_komputerzz
      if (!mapping || mapping.recordType !== 'product' || !mapping.platformId) return null

      const localeTranslations = TARGET_LOCALES
        .map((locale) => {
          const row = detail.translations.find((translation) => translation.locale.toLowerCase() === locale)
          return {
            locale,
            metaTitle: normalizeText(row?.metaTitle),
            metaDescription: normalizeText(row?.metaDescription),
          }
        })
        .filter((translation) => translation.metaTitle || translation.metaDescription)

      return {
        sku: detail.id,
        productId: mapping.platformId,
        baseMetaDescription: normalizeText(detail.metaDescription),
        localeTranslations,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const pushable = mappedProducts.filter((product) => product.baseMetaDescription || product.localeTranslations.length > 0)

  console.log(JSON.stringify({
    scanned: allProducts.length,
    roughCandidates: roughCandidates.length,
    existingMappedSkus: mappedProducts.length,
    pushableSkus: pushable.length,
    skip,
    dryRun,
  }, null, 2))

  if (dryRun) return

  const token = await fetchShopifyAccessToken(vars)
  const shop = vars.SHOPIFY_KOMPUTERZZ_SHOP ?? process.env.SHOPIFY_KOMPUTERZZ_SHOP ?? ''
  const connector = new ShopifyConnector(shop, token)

  let baseUpdated = 0
  let localeRowsUpdated = 0
  const targets = pushable.slice(skip)

  for (const [index, product] of targets.entries()) {
    console.log(`[push] ${index + 1}/${targets.length} ${product.sku}`)
    if (product.baseMetaDescription) {
      await withRetry(`${product.sku} base`, () =>
        connector.updateProduct(product.productId, { metaDescription: product.baseMetaDescription })
      )
      baseUpdated += 1
    }

    if (product.localeTranslations.length > 0) {
      await withRetry(`${product.sku} locales`, () =>
        connector.syncProductTranslations(product.productId, product.localeTranslations)
      )
      localeRowsUpdated += product.localeTranslations.length
    }
  }

  const verifyTargets = pushable.slice(0, Math.min(PUSH_SAMPLE_COUNT, pushable.length))
  const verification: VerifyResult[] = []

  for (const product of verifyTargets) {
    const baseSnapshot = await connector.readProductBaseSnapshot(product.productId)
    const translationSnapshot = await connector.readProductTranslationSnapshot(
      product.productId,
      product.localeTranslations.map((translation) => translation.locale),
    )

    verification.push({
      sku: product.sku,
      productId: product.productId,
      baseMatches: normalizeText(baseSnapshot.metaDescription) === product.baseMetaDescription,
      localeChecks: product.localeTranslations.map((translation) => {
        const snapshotEntries = translationSnapshot.translationsByLocale[translation.locale] ?? []
        const entryMap = new Map(snapshotEntries.map((entry) => [entry.key, normalizeText(entry.value)]))
        return {
          locale: translation.locale,
          metaTitleMatches: entryMap.get('meta_title') === translation.metaTitle,
          metaDescriptionMatches: entryMap.get('meta_description') === translation.metaDescription,
        }
      }),
    })
  }

  console.log(JSON.stringify({
    pushedSkus: pushable.length,
    baseUpdated,
    localeRowsUpdated,
    verified: verification,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
