import { readFile } from 'node:fs/promises'

type TargetLocale = 'fr' | 'de' | 'es' | 'it' | 'nl' | 'fi'

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

interface LocaleTranslation {
  locale: TargetLocale
  title: string
  description: string
  metaDescription: string
}

interface ProductTranslationPlan {
  sku: string
  missingLocales: TargetLocale[]
  sourceLocale: string | null
  title: string
  description: string | null
}

const TARGET_LOCALES: TargetLocale[] = ['fr', 'de', 'es', 'it', 'nl', 'fi']
const LOCALE_NAMES: Record<TargetLocale, string> = {
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  nl: 'Dutch',
  fi: 'Finnish',
}
const LOCALE_STYLE_GUIDANCE: Record<TargetLocale, string> = {
  fr: 'Use natural French retail terminology. Prefer "ordinateur portable" over "laptop". Avoid awkward mixed phrases like "Portable Gaming".',
  de: 'Use natural German retail terminology. Prefer "Notebook" or "Laptop" only if standard German market usage clearly fits; do not leave raw English phrasing by default.',
  es: 'Use natural Spanish retail terminology. Prefer "portatil" or "ordenador portatil" over "laptop" where natural.',
  it: 'Use natural Italian retail terminology. Prefer "notebook" or "portatile" as appropriate, not raw English category phrases like "Gaming Laptop".',
  nl: 'Use natural Dutch retail terminology. Do not leave English memory phrases like "dedicated memory" or mixed phrases like "dedicated geheugen".',
  fi: 'Use natural Finnish retail terminology. Avoid stiff literal calques for memory or graphics phrasing.',
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const FORCE = args.has('--force')
const CONCURRENCY = Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] ?? '4') || 4
const LIMIT = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? '0') || null
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

function localeSpecificQualityIssues(locale: TargetLocale, translation: LocaleTranslation): string[] {
  const haystack = `${translation.title}\n${translation.description}\n${translation.metaDescription}`
  const issues: string[] = []

  const forbiddenByLocale: Record<TargetLocale, RegExp[]> = {
    fr: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
    de: [/\bLaptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
    es: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
    it: [/\bLaptop\b/i, /\bGaming Laptop\b/i, /\bdedicated memory\b/i, /\bshared memory\b/i],
    nl: [/\bdedicated memory\b/i, /\bshared memory\b/i, /\bGaming Laptop\b/i],
    fi: [/\bdedicated memory\b/i, /\bshared memory\b/i, /\bGaming Laptop\b/i],
  }

  for (const pattern of forbiddenByLocale[locale]) {
    if (pattern.test(haystack)) issues.push(`forbidden:${pattern}`)
  }

  if (locale === 'fr' && /\bPortable Gaming\b/i.test(haystack)) issues.push('awkward_fr_portable_gaming')
  if (locale === 'nl' && /\bdedicated geheugen\b/i.test(haystack)) issues.push('awkward_nl_dedicated_geheugen')
  if (locale === 'fi' && /\bjaettu muisti\b/i.test(haystack) && /\bGraphics\b/i.test(haystack)) issues.push('awkward_fi_graphics_phrase')

  return issues
}

function normalizeLocaleTitle(locale: TargetLocale, title: string): string {
  let next = title.trim()

  if (locale === 'nl') {
    next = next
      .replace(/\bLaptop\b/g, 'laptop')
      .replace(/\bNotebook\b/g, 'laptop')
  } else if (locale === 'it') {
    next = next
      .replace(/\bGaming Laptop\b/gi, 'Notebook da gaming')
      .replace(/\bPortatile da Gioco\b/gi, 'Notebook da gaming')
      .replace(/\bLaptop\b/gi, 'Notebook')
      .replace(/\bCustodia Cabina\b/gi, 'Trolley da cabina')
  } else if (locale === 'fi') {
    next = next
      .replace(/\bKannettava Tietokone\b/g, 'kannettava tietokone')
      .replace(/\bPelikannettava\b/g, 'pelikannettava')
  }

  return next.replace(/\s{2,}/g, ' ').trim()
}

function detectShortLocale(sourceUrl: string | null): string | null {
  const match = sourceUrl?.match(/store\.acer\.com\/([a-z]{2})-[a-z]{2}\//i)
  return match ? match[1].toLowerCase() : null
}

function hasUsableTranslation(translation: TranslationRow | undefined): boolean {
  return !!normalizeText(translation?.title) && !!normalizeText(translation?.description)
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
  translations: LocaleTranslation[],
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

async function translateProductLocales(
  openAiKey: string,
  product: { sku: string; title: string; description: string; metaDescription: string | null },
  locales: TargetLocale[],
): Promise<LocaleTranslation[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'acer_locale_fill',
          schema: {
            type: 'object',
            properties: {
              translations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    locale: { type: 'string', enum: TARGET_LOCALES },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    metaDescription: { type: 'string' },
                  },
                  required: ['locale', 'title', 'description', 'metaDescription'],
                  additionalProperties: false,
                },
              },
            },
            required: ['translations'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'Translate Acer product title and description from English into the requested target locales.',
            'Preserve product facts exactly and do not invent any specifications.',
            'Keep model codes, dimensions, units, storage, memory, keyboard markers, and punctuation structure intact where possible.',
            'Output natural e-commerce copy in the target language.',
            'Do not leave obvious English category nouns in non-English output when a natural translation exists.',
            'Examples: translate Laptop, Gaming Laptop, shared memory, dedicated memory, screen/display wording, and processor labels naturally for the target locale.',
            'Avoid mixed-language output such as "dedicated geheugen", "Portable Gaming", or "Gaming Laptop" in non-English locales unless it is truly standard market usage.',
            'Meta description should be one concise SEO-style sentence derived only from the same title and description.',
            'Return strict JSON only.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            sku: product.sku,
            englishTitle: product.title,
            englishDescription: product.description,
            englishMetaDescription: product.metaDescription,
            targetLocales: locales,
          }),
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const json = await res.json() as {
    choices?: Array<{
      message?: { content?: string | null }
    }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty content')
  const parsed = JSON.parse(content) as { translations: LocaleTranslation[] }
  return parsed.translations
}

async function translateSingleLocaleWithRetry(
  openAiKey: string,
  product: { sku: string; title: string; description: string; metaDescription: string | null },
  locale: TargetLocale,
): Promise<LocaleTranslation> {
  let feedback = ''

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'acer_single_locale_fill',
            schema: {
              type: 'object',
              properties: {
                locale: { type: 'string', enum: [locale] },
                title: { type: 'string' },
                description: { type: 'string' },
                metaDescription: { type: 'string' },
              },
              required: ['locale', 'title', 'description', 'metaDescription'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content: [
              `Translate this Acer product from English into ${LOCALE_NAMES[locale]}.`,
              'Preserve product facts exactly and do not invent any specifications.',
              'Keep model codes, dimensions, units, storage, memory capacities, keyboard markers, and punctuation structure intact where possible.',
              'Write natural e-commerce copy for the target market.',
              LOCALE_STYLE_GUIDANCE[locale],
              'Do not leave obvious English category nouns or phrases in the output when a natural local equivalent exists.',
              'Translate terms like Laptop, Gaming Laptop, shared memory, dedicated memory, display wording, and processor labels naturally.',
              'Meta description should be one concise SEO-style sentence derived only from the same title and description.',
              feedback,
              'Return strict JSON only.',
            ].filter(Boolean).join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              sku: product.sku,
              targetLocale: locale,
              englishTitle: product.title,
              englishDescription: product.description,
              englishMetaDescription: product.metaDescription,
            }),
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const json = await res.json() as {
      choices?: Array<{
        message?: { content?: string | null }
      }>
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error('OpenAI returned empty content')
    const translation = JSON.parse(content) as LocaleTranslation
    translation.title = normalizeLocaleTitle(locale, translation.title)
    const issues = localeSpecificQualityIssues(locale, translation)
    if (issues.length === 0) return translation
    feedback = `Previous attempt failed quality checks for these reasons: ${issues.join(', ')}. Rewrite more naturally and eliminate those issues.`
  }

  throw new Error(`Quality gate failed for ${product.sku} ${locale} after 3 attempts`)
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
    const translations: LocaleTranslation[] = []
    for (const locale of plan.missingLocales) {
      const translation = await translateSingleLocaleWithRetry(openAiKey, {
        sku: plan.sku,
        title: plan.title,
        description: plan.description ?? '',
        metaDescription: null,
      }, locale)
      translations.push(translation)
    }

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
