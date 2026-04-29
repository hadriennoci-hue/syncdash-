import * as fs from 'node:fs'
import * as path from 'node:path'
import FirecrawlApp from '@mendable/firecrawl-js'

type Mode = 'auto' | 'acer' | 'ai'
type Locale = 'fr' | 'de' | 'es' | 'it'

interface ProductApiResponse {
  data: {
    id: string
    title: string
    description: string | null
    metaDescription: string | null
    acerStoreSourceUrl: string | null
    acerStoreSourceName: string | null
    translations?: Array<{
      locale: string
      title: string | null
      description: string | null
      metaDescription: string | null
    }>
  }
}

interface TranslationFields {
  title: string
  description: string
  metaDescription: string
}

interface ImportResult {
  sku: string
  locale: Locale
  mode: Mode
  strategyUsed: 'acer' | 'ai'
  sourceUrl: string | null
  translation: TranslationFields
}

interface SearchExtract {
  productUrl?: string | null
}

interface PageExtract {
  sku?: string | null
  title?: string | null
  description?: string | null
  metaDescription?: string | null
}

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=')
    return [key, rest.join('=')]
  })
)

const sku = args.get('--sku')?.trim() ?? ''
const locale = (args.get('--locale')?.trim() ?? '') as Locale
const mode = ((args.get('--mode')?.trim() ?? 'auto') as Mode)
const shouldWrite = process.argv.includes('--write')

if (!sku) throw new Error('Missing --sku=SKU')
if (!['fr', 'de', 'es', 'it'].includes(locale)) throw new Error('Missing or invalid --locale=fr|de|es|it')
if (!['auto', 'acer', 'ai'].includes(mode)) throw new Error('Invalid --mode=auto|acer|ai')

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

function stripMarkdownFences(input: string): string {
  return input.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
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

function cleanDescription(input: string): string {
  const noisePatterns = [
    /l[' ]offre se termine dans:?/i,
    /offer ends in:?/i,
    /angebot endet in:?/i,
    /oferta termina en:?/i,
    /offerta termina tra:?/i,
    /questa offerta terminer[aà] in:?/i,
    /^\d+\s*(jours|heures|minutes|secondes|days|hours|minutes|seconds)$/i,
    /^\d+\s*(tage|stunden|minuten|sekunden)$/i,
    /^\d+\s*(dias|horas|minutos|segundos)$/i,
    /^\d+\s*(giorni|ore|minuti|secondi)$/i,
    /^\d+\s*(jours|heures|minutes|secondes|tage|stunden|minuten|sekunden|dias|horas|minutos|segundos|giorni|ore|minuti|secondi)$/i,
    /^en stock$/i,
    /^agotado$/i,
    /^automatiquement appliqu[ée] sur votre panier$/i,
    /^aplicado autom[aá]ticamente en la cesta$/i,
    /^\(livraison\s*:.*\)$/i,
    /^\(entrega.*\)$/i,
    /^pagar como nuevo cliente/i,
    /^crear una cuenta/i,
    /^ver estado de orden/i,
    /^rastrear historial de orden/i,
    /^comprar m[aá]s r[aá]pidamente/i,
    /^pagar usando su cuenta/i,
    /^direcci[oó]n de correo electr[oó]nico$/i,
    /^contraseñ?a$/i,
    /^iniciar sesi[oó]n$/i,
    /^cargando\.\.\.$/i,
    /^effettua il checkout come nuovo cliente/i,
    /^i numerosi vantaggi di creare un account/i,
    /^controlla l'ordine/i,
    /^traccia lo storico/i,
    /^effettua il checkout pi[uù] velocemente/i,
    /^00(?:jours|heures|minutes|secondes|tage|stunden|minuten|sekunden|d[ií]as|horas|minutos|segundos|min\.?)$/i,
  ]

  const cutFromPatterns = [
    /ten en cuenta que la pestaña/i,
    /effettua il checkout come nuovo cliente/i,
    /pagar como nuevo cliente/i,
  ]

  const normalized = normalizePlainText(input)
  const cutIndex = cutFromPatterns
    .map((pattern) => normalized.search(pattern))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const truncated = typeof cutIndex === 'number' ? normalized.slice(0, cutIndex) : normalized

  const cleanedLines = truncated
    .split('\n')
    .map((line) => line.replace(/^[\s*-]+/, '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function cleanDescriptionV2(input: string): string {
  const cleaned = cleanDescription(input)
  const noisePatterns = [
    /^le prix le plus bas/i,
    /^disponible$/i,
    /^funktionen$/i,
    /^technische informationen/i,
    /^kompatibilit[aä]t/i,
    /^garantie$/i,
    /^resoluci[oó]n ultraelevada/i,
    /^ricarica superveloce/i,
    /^trasferimento dati ad alta velocit[aà]/i,
    /^gigabit ethernet/i,
    /^prodotto 2 in 1 dal design unico/i,
    /^hub usb-c supporta fino a tre schermi/i,
  ]

  const cutFromPatterns = [
    /ten en cuenta que la pestaña/i,
    /effettua il checkout come nuovo cliente/i,
    /pagar como nuevo cliente/i,
  ]

  const cutIndex = cutFromPatterns
    .map((pattern) => cleaned.search(pattern))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  const truncated = typeof cutIndex === 'number' ? cleaned.slice(0, cutIndex) : cleaned

  const lines = truncated
    .split('\n')
    .map((line) => line
      .replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1')
      .replace(/\*+/g, '')
      .replace(/^[\s*-]+/, '')
      .trim())
    .filter(Boolean)
    .filter((line) => !/^\d+[.,]\d{2}\s*€$/i.test(line))
    .filter((line) => !/^\d+\s*€\s*(de r[ée]duction|de descuento)$/i.test(line))
    .filter((line) => !/^\(consegna.*\)$/i.test(line))
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function requirePlainTextFields(data: PageExtract | TranslationFields): TranslationFields {
  const title = normalizePlainText(data.title)
  const description = cleanDescriptionV2(normalizePlainText(data.description))
  const metaDescription = normalizePlainText(data.metaDescription)

  if (!title) throw new Error('Missing translated title')
  if (!description) throw new Error('Missing translated description')
  if (!metaDescription) throw new Error('Missing translated meta description')
  return { title, description, metaDescription }
}

async function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function getProduct(productSku: string): Promise<ProductApiResponse['data']> {
  const result = await apiFetchJson<ProductApiResponse>(`${BASE_URL}/api/products/${encodeURIComponent(productSku)}`, {
    headers: getApiHeaders(),
  })
  return result.data
}

async function putTranslation(productSku: string, targetLocale: Locale, translation: TranslationFields): Promise<void> {
  await apiFetchJson(
    `${BASE_URL}/api/products/${encodeURIComponent(productSku)}/translations`,
    {
      method: 'PUT',
      headers: getApiHeaders(),
      body: JSON.stringify({
        translations: [{
          locale: targetLocale,
          title: translation.title,
          description: translation.description,
          metaDescription: translation.metaDescription,
        }],
        triggeredBy: 'agent',
      }),
    }
  )
}

async function validateLocaleProductUrl(app: FirecrawlApp, url: string, expectedSku: string): Promise<boolean> {
  const result = await app.scrapeUrl(url, {
    formats: ['extract'],
    extract: {
      prompt: `Check whether this is the Acer Store product page for SKU ${expectedSku}. Return the exact SKU and title if present, otherwise return nulls.`,
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
  const extract = (result as { extract?: { sku?: string | null } }).extract
  return normalizePlainText(extract?.sku).toUpperCase() === expectedSku.toUpperCase()
}

async function firecrawlFindLocaleUrl(product: ProductApiResponse['data'], targetLocale: Locale): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY missing')
  const app = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY })
  const localeStore = localeStoreMap[targetLocale]
  const directCandidate = product.acerStoreSourceUrl?.replace(/store\.acer\.com\/[a-z]{2}-[a-z]{2}\//i, `store.acer.com/${localeStore}/`) ?? null

  if (directCandidate && await validateLocaleProductUrl(app, directCandidate, product.id)) {
    return directCandidate
  }

  const q = `site:store.acer.com/${localeStore} "${product.id}" Acer`
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=${targetLocale}&gl=${targetLocale.toUpperCase()}`
  const search = await app.scrapeUrl(googleUrl, {
    formats: ['extract'],
    extract: {
      prompt:
        `Find the best Acer Store product URL for SKU ${product.id} on locale ${localeStore}. ` +
        'Return only a product page URL on store.acer.com for that locale. If nothing matches, return null.',
      schema: {
        type: 'object',
        properties: {
          productUrl: { type: ['string', 'null'] },
        },
      } as never,
    },
  })

  if (!search.success) return null
  const extracted = (search as { extract?: SearchExtract }).extract
  const url = normalizePlainText(extracted?.productUrl)
  if (!url) return null
  if (!url.includes(`store.acer.com/${localeStore}`)) return null
  if (!await validateLocaleProductUrl(app, url, product.id)) return null
  return url
}

async function firecrawlExtractTranslation(product: ProductApiResponse['data'], targetLocale: Locale): Promise<{ sourceUrl: string; translation: TranslationFields }> {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY missing')
  const sourceUrl = await firecrawlFindLocaleUrl(product, targetLocale)
  if (!sourceUrl) throw new Error(`No locale Acer URL found for ${product.id} ${targetLocale}`)

  const app = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY })
  const page = await app.scrapeUrl(sourceUrl, {
    formats: ['extract'],
    extract: {
      prompt:
        `Extract the localized Acer product content for SKU ${product.id}. ` +
        'Return the exact localized title, the full product description as plain text with line breaks only, and a concise SEO meta description in the same language. ' +
        'Do not return HTML, markdown, bullets, or invented fields. If the SKU on the page is different, return nulls.',
      schema: {
        type: 'object',
        properties: {
          sku: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          metaDescription: { type: ['string', 'null'] },
        },
      } as never,
    },
  })

  if (!page.success) throw new Error(`Firecrawl scrape failed for ${sourceUrl}`)
  const extract = (page as { extract?: PageExtract }).extract ?? {}
  const foundSku = normalizePlainText(extract.sku).toUpperCase()
  if (foundSku !== product.id.toUpperCase()) {
    throw new Error(`Locale Acer page mismatch: expected ${product.id}, got ${foundSku}`)
  }

  return {
    sourceUrl,
    translation: requirePlainTextFields(extract),
  }
}

async function aiTranslate(product: ProductApiResponse['data'], targetLocale: Locale): Promise<TranslationFields> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing')

  const prompt = [
    `Translate the following Acer product content into locale ${targetLocale}.`,
    'Output strict JSON with keys: title, description, metaDescription.',
    'Rules:',
    '- Translate only the information explicitly present in the source title, source description, and source meta description below.',
    '- Do not add features, specs, materials, benefits, compatibility claims, or marketing details that are not explicitly present in the source text for this same SKU.',
    '- If source meta description is missing, derive it only by compressing the same source title and source description. Do not invent new facts.',
    '- Keep brand names, model names, SKUs, units, capacities, and technical specs unchanged.',
    '- Description must be plain text with paragraph breaks using newline characters only.',
    '- No HTML, markdown, bullets, or commentary.',
    '- Meta description should be concise and commercial, around one sentence.',
    '',
    `SKU: ${product.id}`,
    `Title: ${product.title}`,
    `Description: ${product.description ?? ''}`,
    `Meta description: ${product.metaDescription ?? ''}`,
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'product_translation',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              metaDescription: { type: 'string' },
            },
            required: ['title', 'description', 'metaDescription'],
          },
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
  const parsed = JSON.parse(stripMarkdownFences(outputText)) as TranslationFields
  return requirePlainTextFields(parsed)
}

async function importTranslation(): Promise<ImportResult> {
  const product = await getProduct(sku)

  if (mode === 'acer' || mode === 'auto') {
    try {
      const { sourceUrl, translation } = await firecrawlExtractTranslation(product, locale)
      if (shouldWrite) await putTranslation(product.id, locale, translation)
      return {
        sku: product.id,
        locale,
        mode,
        strategyUsed: 'acer',
        sourceUrl,
        translation,
      }
    } catch (error) {
      if (mode === 'acer') throw error
    }
  }

  const translation = await aiTranslate(product, locale)
  if (shouldWrite) await putTranslation(product.id, locale, translation)
  return {
    sku: product.id,
    locale,
    mode,
    strategyUsed: 'ai',
    sourceUrl: null,
    translation,
  }
}

importTranslation()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
