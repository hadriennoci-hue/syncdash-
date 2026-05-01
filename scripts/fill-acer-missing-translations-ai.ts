import { readFile } from 'node:fs/promises'
import {
  ACER_TARGET_LOCALES,
  type AcerLocaleTranslation,
  type AcerTargetLocale as TargetLocale,
  acerLocaleNeedsTranslation,
  translateAcerLocalesWithRetry,
} from '@/lib/acer/locale-translation'

interface StockRow {
  productId: string
  sourceUrl: string | null
  sourceName: string | null
  status: string | null
  quantity: number | null
}

interface TranslationRow {
  locale: string
  title: string | null
  description: string | null
  metaTitle: string | null
  metaDescription: string | null
}

interface ProductDetail {
  id: string
  title: string
  description: string | null
  metaDescription: string | null
  translations: TranslationRow[]
  acerStoreSourceUrl: string | null
  acerStoreSourceName: string | null
}

interface ProductTranslationPlan {
  sku: string
  missingLocales: TargetLocale[]
  sourceLocale: string | null
  title: string
  description: string | null
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const FORCE = args.has('--force')
const CONCURRENCY = Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] ?? '4') || 4
const LIMIT = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? '0') || null
const LOCALES_ARG = process.argv.find((arg) => arg.startsWith('--locales='))?.split('=')[1] ?? ''
const TARGET_LOCALES: TargetLocale[] = (LOCALES_ARG
  ? LOCALES_ARG.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  : ACER_TARGET_LOCALES) as TargetLocale[]
const ONLY_SKU = process.argv.find((arg) => arg.startsWith('--sku='))?.split('=')[1] ?? null
const SKU_LIST = (process.argv.find((arg) => arg.startsWith('--sku-list='))?.split('=')[1] ?? '')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean)
const TARGETED_SKUS = new Set([...(ONLY_SKU ? [ONLY_SKU.toUpperCase()] : []), ...SKU_LIST])

function log(message: string): void {
  console.log(`[acer-l10n ${new Date().toISOString()}] ${message}`)
}

function parseEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.+)$/)
    if (!match) continue
    vars[match[1]] = match[2].trim().replace(/^"|"$/g, '')
  }
  return vars
}

function pickEnv(name: string, vars: Record<string, string>): string {
  const value = process.env[name] ?? vars[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function pickOptionalEnv(names: string[], vars: Record<string, string>): string | null {
  for (const name of names) {
    const value = process.env[name] ?? vars[name]
    if (value) return value
  }
  return null
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

function detectShortLocale(sourceUrl: string | null): string | null {
  const match = sourceUrl?.match(/store\.acer\.com\/([a-z]{2})-[a-z]{2}\//i)
  return match ? match[1].toLowerCase() : null
}

function hasUsableTranslation(translation: TranslationRow | undefined): boolean {
  return acerLocaleNeedsTranslation(translation)
}

async function apiFetchJson<T>(url: string, headers: HeadersInit, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function getStockRows(baseUrl: string, headers: HeadersInit): Promise<StockRow[]> {
  const result = await apiFetchJson<{ data?: { stock?: StockRow[] } }>(
    `${baseUrl}/api/warehouses/acer_store/stock?withProduct=1`,
    headers,
  )
  return result.data?.stock ?? []
}

async function getProductDetail(baseUrl: string, headers: HeadersInit, sku: string): Promise<ProductDetail> {
  const result = await apiFetchJson<{ data: ProductDetail }>(
    `${baseUrl}/api/products/${encodeURIComponent(sku)}`,
    headers,
  )
  return result.data
}

async function putTranslations(
  baseUrl: string,
  headers: HeadersInit,
  sku: string,
  translations: AcerLocaleTranslation[],
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/translations`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      translations: translations.map((translation) => ({
        locale: translation.locale,
        title: translation.title,
        description: translation.description,
        metaDescription: translation.metaDescription,
      })),
      triggeredBy: 'agent',
    }),
  })
  if (!res.ok) throw new Error(`PUT translations ${sku} failed: ${res.status} ${await res.text()}`)
}

async function runConcurrent<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  const queue = new Set<Promise<void>>()
  let index = 0
  for (const item of items) {
    const promise = worker(item, index).finally(() => queue.delete(promise))
    queue.add(promise)
    index += 1
    if (queue.size >= limit) await Promise.race(queue)
  }
  await Promise.all(queue)
}

async function main(): Promise<void> {
  const vars = parseEnv(await readFile('.dev.vars', 'utf8'))
  const baseUrl = pickOptionalEnv(['WIZHARD_URL', 'NEXT_PUBLIC_APP_URL'], vars) ?? 'https://wizhard.store'
  const agentToken = pickEnv('AGENT_BEARER_TOKEN', vars)
  const accessId = pickEnv('CF_ACCESS_CLIENT_ID', vars)
  const accessSecret = pickEnv('CF_ACCESS_CLIENT_SECRET', vars)
  const openAiKey = pickEnv('OPENAI_API_KEY', vars)

  const headers: HeadersInit = {
    Authorization: `Bearer ${agentToken}`,
    'CF-Access-Client-Id': accessId,
    'CF-Access-Client-Secret': accessSecret,
  }

  const stockRows = await getStockRows(baseUrl, headers)
  const scopedRows = stockRows
    .filter((row) => TARGETED_SKUS.size > 0 ? TARGETED_SKUS.has(row.productId.toUpperCase()) : true)
    .filter((row) => !!row.sourceUrl)

  const uniqueSkus = [...new Set(scopedRows.map((row) => row.productId))]
  const limitedSkus = LIMIT ? uniqueSkus.slice(0, LIMIT) : uniqueSkus

  log(`Inspecting ${limitedSkus.length} ACER product(s) for locales ${TARGET_LOCALES.join(', ')}${DRY_RUN ? ' [dry-run]' : ''}`)

  const plans: ProductTranslationPlan[] = []
  for (const sku of limitedSkus) {
    const detail = await getProductDetail(baseUrl, headers, sku)
    const englishTitle = normalizeText(detail.title)
    const englishDescription = normalizeText(detail.description)
    if (!englishTitle || !englishDescription) continue

    const sourceLocale = detectShortLocale(detail.acerStoreSourceUrl)
    const existingByLocale = new Map(detail.translations.map((translation) => [translation.locale.toLowerCase(), translation]))
    const missingLocales = TARGET_LOCALES.filter((locale) => {
      if (!FORCE && hasUsableTranslation(existingByLocale.get(locale))) return false
      return true
    })
    if (missingLocales.length === 0) continue

    plans.push({
      sku,
      missingLocales,
      sourceLocale,
      title: englishTitle,
      description: englishDescription,
    })
  }

  const localeCounts = Object.fromEntries(TARGET_LOCALES.map((locale) => [locale, 0])) as Record<TargetLocale, number>
  for (const plan of plans) {
    for (const locale of plan.missingLocales) localeCounts[locale] += 1
  }

  if (DRY_RUN) {
    const preview = plans.slice(0, 10).map((plan) => ({
      sku: plan.sku,
      sourceLocale: plan.sourceLocale,
      missingLocales: plan.missingLocales,
      title: plan.title,
    }))
    log(`Products needing locale fill: ${plans.length}`)
    log(`Locale gaps: ${JSON.stringify(localeCounts)}`)
    console.log(JSON.stringify({ totalProductsNeedingFill: plans.length, localeCounts, preview }, null, 2))
    return
  }

  let updatedProducts = 0
  await runConcurrent(plans, CONCURRENCY, async (plan, index) => {
    const translations = await translateAcerLocalesWithRetry(openAiKey, {
      sku: plan.sku,
      title: plan.title,
      description: plan.description ?? '',
      metaDescription: null,
    }, plan.missingLocales)

    await putTranslations(baseUrl, headers, plan.sku, translations)
    updatedProducts += 1
    log(`updated ${plan.sku} (${index + 1}/${plans.length}) locales=${translations.map((translation) => translation.locale).join(',')}`)
  })

  log(`Done. updatedProducts=${updatedProducts} plannedProducts=${plans.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
