import * as fs from 'node:fs'
import * as path from 'node:path'

type Locale = 'fr' | 'de' | 'es' | 'it' | 'nl' | 'fi'

type ProductListRow = {
  id: string
}

type ProductListResponse = {
  data: ProductListRow[]
}

type TranslationRow = {
  locale: string
  title: string | null
  description: string | null
  metaTitle: string | null
  metaDescription: string | null
}

type ProductDetail = {
  id: string
  title: string
  description: string | null
  metaDescription: string | null
  translations: TranslationRow[]
}

type ProductDetailResponse = {
  data: ProductDetail
}

type LocaleDescription = {
  locale: Locale
  description: string
}

type BackfillPlan = {
  sku: string
  title: string
  description: string
  missingLocales: Locale[]
}

const TARGET_LOCALES: Locale[] = ['fr', 'de', 'es', 'it', 'nl', 'fi']
const RETRY_DELAYS_MS = [2000, 5000]

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=')
    return [key, rest.join('=')]
  }),
)

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = Math.max(0, Number.parseInt(args.get('--limit') ?? '0', 10) || 0)
const CONCURRENCY = Math.max(1, Math.min(12, Number.parseInt(args.get('--concurrency') ?? '6', 10) || 6))
const SKU_LIST = new Set(
  (args.get('--sku-list') ?? '')
    .split(',')
    .map((sku) => sku.trim().toUpperCase())
    .filter(Boolean),
)

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
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

function getRequiredEnv(vars: Record<string, string>, name: string): string {
  const value = process.env[name] ?? vars[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function getApiHeaders(vars: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${getRequiredEnv(vars, 'AGENT_BEARER_TOKEN')}`,
    'CF-Access-Client-Id': getRequiredEnv(vars, 'CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': getRequiredEnv(vars, 'CF_ACCESS_CLIENT_SECRET'),
    'Content-Type': 'application/json',
  }
}

function log(message: string): void {
  console.log(`[locale-desc ${new Date().toISOString()}] ${message}`)
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

async function apiFetchJson<T>(url: string, headers: Record<string, string>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers,
    ...init,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function getAllProducts(baseUrl: string, headers: Record<string, string>): Promise<ProductListRow[]> {
  const result = await apiFetchJson<ProductListResponse>(`${baseUrl}/api/products?page=1&perPage=1000`, headers)
  return result.data ?? []
}

async function getProductDetail(baseUrl: string, headers: Record<string, string>, sku: string): Promise<ProductDetail> {
  const result = await apiFetchJson<ProductDetailResponse>(
    `${baseUrl}/api/products/${encodeURIComponent(sku)}`,
    headers,
  )
  return result.data
}

async function putDescriptions(
  baseUrl: string,
  headers: Record<string, string>,
  sku: string,
  translations: LocaleDescription[],
): Promise<void> {
  await apiFetchJson(
    `${baseUrl}/api/products/${encodeURIComponent(sku)}/translations`,
    headers,
    {
      method: 'PUT',
      body: JSON.stringify({
        translations: translations.map((translation) => ({
          locale: translation.locale,
          description: translation.description,
        })),
        triggeredBy: 'agent',
      }),
    },
  )
}

function buildPrompt(locales: Locale[]): string {
  return [
    `Translate the English product description into these locales: ${locales.join(', ')}.`,
    'Use the English title only for context; translate the description only.',
    'Preserve product facts exactly and do not invent any specifications, features, or accessories.',
    'Keep SKU-like codes, capacities, units, and model names unchanged.',
    'Output plain text only inside strict JSON.',
    'Do not emit HTML, markdown, bullets, trademark symbols, replacement characters, or broken encoding artifacts.',
    'Use natural e-commerce wording for each target locale.',
  ].join(' ')
}

async function translateMissingDescriptions(
  openAiKey: string,
  plan: BackfillPlan,
): Promise<LocaleDescription[]> {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: { type: 'string', enum: plan.missingLocales },
            description: { type: 'string' },
          },
          required: ['locale', 'description'],
        },
      },
    },
    required: ['translations'],
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          input: [
            {
              role: 'system',
              content: buildPrompt(plan.missingLocales),
            },
            {
              role: 'user',
              content: JSON.stringify({
                sku: plan.sku,
                englishTitle: plan.title,
                englishDescription: plan.description,
                targetLocales: plan.missingLocales,
              }),
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'locale_description_backfill',
              schema,
              strict: true,
            },
          },
        }),
      })

      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)

      const json = await res.json() as {
        output_text?: string
        output?: Array<{
          content?: Array<{
            type?: string
            text?: string
          }>
        }>
      }

      const outputText = json.output_text
        ?? json.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text' && typeof item.text === 'string')?.text
        ?? '{}'

      const parsed = JSON.parse(outputText) as { translations?: Array<{ locale: Locale; description: string }> }
      const byLocale = new Map<Locale, string>()
      for (const translation of parsed.translations ?? []) {
        const locale = translation.locale
        const description = normalizeText(translation.description)
        if (locale && description) byLocale.set(locale, description)
      }

      const results = plan.missingLocales.map((locale) => {
        const description = byLocale.get(locale)
        if (!description) throw new Error(`Missing translated description for ${plan.sku} ${locale}`)
        return { locale, description }
      })

      return results
    } catch (error) {
      lastError = error
      if (attempt === RETRY_DELAYS_MS.length) break
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to translate ${plan.sku}`)
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

async function main(): Promise<void> {
  const vars = readDevVars()
  const baseUrl = vars.WIZHARD_URL ?? process.env.WIZHARD_URL ?? 'https://wizhard.store'
  const headers = getApiHeaders(vars)
  const openAiKey = getRequiredEnv(vars, 'OPENAI_API_KEY')

  const products = await getAllProducts(baseUrl, headers)
  const scopedProducts = SKU_LIST.size > 0
    ? products.filter((product) => SKU_LIST.has(product.id.toUpperCase()))
    : products
  const limitedProducts = LIMIT > 0 ? scopedProducts.slice(0, LIMIT) : scopedProducts

  log(`Inspecting ${limitedProducts.length} product(s)${DRY_RUN ? ' [dry-run]' : ''}`)

  const details = await mapLimit(
    limitedProducts,
    Math.min(CONCURRENCY, 12),
    (product) => getProductDetail(baseUrl, headers, product.id),
  )

  const plans: BackfillPlan[] = []
  for (const detail of details) {
    const title = normalizeText(detail.title)
    const description = normalizeText(detail.description)
    if (!title || !description) continue

    const translationMap = new Map(detail.translations.map((translation) => [translation.locale.toLowerCase(), translation]))
    const missingLocales = TARGET_LOCALES.filter((locale) => !normalizeText(translationMap.get(locale)?.description))
    if (missingLocales.length === 0) continue

    plans.push({
      sku: detail.id,
      title,
      description,
      missingLocales,
    })
  }

  const localeCounts = Object.fromEntries(
    TARGET_LOCALES.map((locale) => [locale, plans.filter((plan) => plan.missingLocales.includes(locale)).length]),
  ) as Record<Locale, number>

  fs.mkdirSync('.tmp', { recursive: true })
  fs.writeFileSync('.tmp/locale-description-backfill-plan.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    totalProductsInspected: limitedProducts.length,
    totalPlannedProducts: plans.length,
    localeCounts,
    plans,
  }, null, 2))

  log(`Planned products=${plans.length} localeCounts=${JSON.stringify(localeCounts)}`)
  if (DRY_RUN) return

  let updatedProducts = 0
  let updatedLocaleRows = 0

  await mapLimit(plans, CONCURRENCY, async (plan, index) => {
    const translations = await translateMissingDescriptions(openAiKey, plan)
    await putDescriptions(baseUrl, headers, plan.sku, translations)
    updatedProducts += 1
    updatedLocaleRows += translations.length
    log(`updated ${plan.sku} (${index + 1}/${plans.length}) locales=${translations.map((translation) => translation.locale).join(',')}`)
  })

  log(`Done. updatedProducts=${updatedProducts} updatedLocaleRows=${updatedLocaleRows}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
