import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  buildBaseSeoDraft,
  buildGoogleQuery,
  buildLocaleMetaTitle,
  buildSeoPromptContext,
  compactLocaleMetaDescription,
  normalizeSeoDescription,
  normalizeSeoTitle,
  type SeoProductSource,
  type SeoTranslationRow,
} from '@/lib/seo/product-metadata'

type ProductListRow = {
  id: string
  title: string
  updatedAt?: string | null
}

type ProductDetailResponse = {
  data: SeoProductSource
}

type PaginatedProductsResponse = {
  data: ProductListRow[]
  meta: {
    requestId: string
    page: number
    perPage: number
    total: number
    totalPages: number
  }
}

type AiSeoCopy = {
  metaTitle: string
  metaDescription: string
}

type SeoTranslationUpdate = {
  locale: string
  metaTitle?: string | null
  metaDescription?: string | null
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
        if (idx < 0) continue
        const key = line.slice(0, idx).trim()
        const value = line.slice(idx + 1).trim()
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

function normalizePlainText(input: string | null | undefined): string {
  return (input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const vars = readDevVars()
const BASE_URL = vars.WIZHARD_URL ?? 'https://wizhard.store'
const OPENAI_API_KEY = vars.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? ''

function getApiHeaders(): Record<string, string> {
  const token = vars.AGENT_BEARER_TOKEN ?? process.env.AGENT_BEARER_TOKEN ?? ''
  const clientId = vars.CF_ACCESS_CLIENT_ID ?? vars.CLOUDFLARE_ACCESS_CLIENT_ID ?? process.env.CF_ACCESS_CLIENT_ID ?? ''
  const clientSecret = vars.CF_ACCESS_CLIENT_SECRET ?? vars.CLOUDFLARE_ACCESS_CLIENT_SECRET ?? process.env.CF_ACCESS_CLIENT_SECRET ?? ''
  return {
    Authorization: `Bearer ${token}`,
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  }
}

async function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function getProducts(page: number, perPage: number): Promise<PaginatedProductsResponse> {
  return apiFetchJson<PaginatedProductsResponse>(
    `${BASE_URL}/api/products?page=${page}&perPage=${perPage}`,
    { headers: getApiHeaders() }
  )
}

async function getProductDetail(sku: string): Promise<SeoProductSource> {
  const result = await apiFetchJson<ProductDetailResponse>(
    `${BASE_URL}/api/products/${encodeURIComponent(sku)}`,
    { headers: getApiHeaders() }
  )
  return result.data
}

async function patchBaseMetaDescription(sku: string, metaDescription: string): Promise<void> {
  await apiFetchJson(
    `${BASE_URL}/api/products/${encodeURIComponent(sku)}/local`,
    {
      method: 'PATCH',
      headers: getApiHeaders(),
      body: JSON.stringify({
        fields: { metaDescription },
        triggeredBy: 'agent',
      }),
    }
  )
}

async function putTranslations(sku: string, translations: SeoTranslationUpdate[]): Promise<void> {
  await apiFetchJson(
    `${BASE_URL}/api/products/${encodeURIComponent(sku)}/translations`,
    {
      method: 'PUT',
      headers: getApiHeaders(),
      body: JSON.stringify({
        translations,
        triggeredBy: 'agent',
      }),
    }
  )
}

async function googleSearchHints(query: string): Promise<string[]> {
  try {
    const url = `https://www.google.com/search?gbv=1&hl=en&num=5&q=${encodeURIComponent(query)}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      })

      if (!res.ok) return []
      const html = await res.text()
      const matches = [...html.matchAll(/<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/gi)]
      const hints = matches
        .map((match) => {
          const urlValue = decodeURIComponent(match[1] ?? '')
          const title = normalizePlainText(match[2] ?? '')
            .replace(/<[^>]+>/g, ' ')
          return [title, urlValue].filter(Boolean).join(' — ')
        })
        .filter(Boolean)

      return hints.slice(0, 3)
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return []
  }
}

async function generateAiSeoCopy(params: {
  product: SeoProductSource
  locale: string
  context: string
  hints: string[]
}): Promise<AiSeoCopy> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing')

  const prompt = [
    `Generate SEO metadata for the product below in ${params.locale === 'en' ? 'English' : params.locale}.`,
    'Return strict JSON with keys: metaTitle, metaDescription.',
    'Rules:',
    '- Keep metaTitle concise and natural, ideally under 60 characters.',
    '- Keep metaDescription concise, search-friendly, and factually grounded in the provided context only.',
    '- Keep metaDescription under 155 characters when possible.',
    '- Do not invent specs or claims.',
    '- Strip trademark symbols and broken encoding artifacts.',
    '- Prefer retail phrasing natural to the target locale.',
    params.hints.length > 0 ? `Google hints:\n${params.hints.map((hint) => `- ${hint}`).join('\n')}` : null,
    `Context:\n${params.context}`,
  ].filter(Boolean).join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'seo_copy',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              metaTitle: { type: 'string' },
              metaDescription: { type: 'string' },
            },
            required: ['metaTitle', 'metaDescription'],
          },
        },
      },
      messages: [
        { role: 'system', content: 'You write concise SEO metadata for retail products.' },
        { role: 'user', content: prompt },
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
  const parsed = JSON.parse(content) as AiSeoCopy
  return {
    metaTitle: normalizeSeoTitle(parsed.metaTitle) ?? normalizeSeoTitle(params.product.title) ?? params.product.title,
    metaDescription: normalizeSeoDescription(parsed.metaDescription, 155) ?? normalizeSeoDescription(params.product.description, 155) ?? '',
  }
}

function collectProducts(rows: ProductListRow[], allowedSkus: Set<string> | null, limit: number | null): ProductListRow[] {
  const filtered = allowedSkus ? rows.filter((row) => allowedSkus.has(row.id)) : rows
  return typeof limit === 'number' ? filtered.slice(0, limit) : filtered
}

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq < 0) {
      out[arg.slice(2)] = true
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    }
  }
  return out
}

const args = parseArgs()
const shouldWrite = Boolean(args.write)
const dryRun = !shouldWrite
const overwrite = Boolean(args.overwrite) || shouldWrite
const skuFilter = typeof args.sku === 'string'
  ? new Set(String(args.sku).split(',').map((sku) => sku.trim()).filter(Boolean))
  : null
const maxProducts = typeof args.limit === 'string'
  ? Number.parseInt(args.limit, 10)
  : null
const pageSize = 100

async function main(): Promise<void> {
  const allRows: ProductListRow[] = []
  let page = 1
  while (true) {
    const result = await getProducts(page, pageSize)
    allRows.push(...result.data)
    if (page >= result.meta.totalPages) break
    page += 1
  }

  const targetRows = collectProducts(allRows, skuFilter, Number.isFinite(maxProducts ?? NaN) ? (maxProducts as number) : null)
  console.log(`Loaded ${allRows.length} products, targeting ${targetRows.length} rows (${dryRun ? 'dry-run' : 'write'})`)

  let baseUpdated = 0
  let translationUpdated = 0
  let aiUsed = 0
  let weakFitCount = 0

  const batchSize = 4
  for (let i = 0; i < targetRows.length; i += batchSize) {
    const batch = targetRows.slice(i, i + batchSize)
    const details = await Promise.all(batch.map((row) => getProductDetail(row.id)))

    for (const product of details) {
      const baseDraft = buildBaseSeoDraft(product)
      if (baseDraft.weakFit) weakFitCount += 1

      const currentBase = normalizeSeoDescription(product.metaDescription)
      let nextBase = baseDraft.baseMetaDescription

      if ((!nextBase || baseDraft.weakFit) && OPENAI_API_KEY) {
        const hints = await googleSearchHints(buildGoogleQuery(product))
        const aiCopy = await generateAiSeoCopy({
          product,
          locale: 'en',
          context: buildSeoPromptContext(product),
          hints,
        })
        nextBase = aiCopy.metaDescription || nextBase
        aiUsed += 1
      }

      if (nextBase) {
        const normalizedBase = normalizeSeoDescription(nextBase)
        if (normalizedBase && (overwrite || normalizedBase !== currentBase)) {
          console.log(`[base] ${product.id} -> ${normalizedBase}`)
          if (shouldWrite) await patchBaseMetaDescription(product.id, normalizedBase)
          baseUpdated += 1
        }
      }

      const updates: SeoTranslationUpdate[] = []
      for (const translation of product.translations) {
        const locale = translation.locale.toLowerCase()
        const titleCandidate = buildLocaleMetaTitle(translation.title, product.title)
        const baseLocaleDescription =
          compactLocaleMetaDescription(translation.metaDescription) ??
          compactLocaleMetaDescription(translation.description)

        let nextMetaTitle = titleCandidate
        let nextMetaDescription = baseLocaleDescription

        const localeNeedsAi =
          !nextMetaDescription ||
          !nextMetaTitle

        if (localeNeedsAi && OPENAI_API_KEY) {
          const hints = await googleSearchHints(buildGoogleQuery(product))
          const aiCopy = await generateAiSeoCopy({
            product,
            locale,
            context: [
              buildSeoPromptContext(product),
              translation.title ? `Locale title: ${normalizePlainText(translation.title)}` : null,
              translation.description ? `Locale description: ${normalizePlainText(translation.description)}` : null,
            ].filter(Boolean).join('\n'),
            hints,
          })
          nextMetaTitle = aiCopy.metaTitle
          nextMetaDescription = aiCopy.metaDescription
          aiUsed += 1
        }

        nextMetaTitle = normalizeSeoTitle(nextMetaTitle) ?? normalizeSeoTitle(translation.title ?? product.title)
        nextMetaDescription = normalizeSeoDescription(nextMetaDescription)

        const currentMetaTitle = normalizeSeoTitle(translation.metaTitle)
        const currentMetaDescription = normalizeSeoDescription(translation.metaDescription)

        const changedMetaTitle = nextMetaTitle && (overwrite || nextMetaTitle !== currentMetaTitle)
        const changedMetaDescription = nextMetaDescription && (overwrite || nextMetaDescription !== currentMetaDescription)

        if (changedMetaTitle || changedMetaDescription) {
          updates.push({
            locale,
            ...(changedMetaTitle ? { metaTitle: nextMetaTitle } : {}),
            ...(changedMetaDescription ? { metaDescription: nextMetaDescription } : {}),
          })
        }
      }

      if (updates.length > 0) {
        console.log(`[translations] ${product.id} -> ${updates.length} locale rows`)
        if (shouldWrite) await putTranslations(product.id, updates)
        translationUpdated += updates.length
      }
    }
  }

  console.log(JSON.stringify({
    dryRun,
    overwrite,
    targetedProducts: targetRows.length,
    baseUpdated,
    translationUpdated,
    aiUsed,
    weakFitCount,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
