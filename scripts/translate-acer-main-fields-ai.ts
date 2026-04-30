import { readFile } from 'node:fs/promises'

interface StockRow {
  productId: string
  status: string | null
  pendingReview: number
  sourceUrl: string | null
  sourceName: string | null
  imageCount: number
  categoryCount: number
}

interface ProductDetail {
  id: string
  title: string
  description: string | null
}

interface TranslationItem {
  sku: string
  englishTitle: string
  englishDescription: string | null
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const CONCURRENCY = Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] ?? '6') || 6
const ONLY_SKU = process.argv.find((arg) => arg.startsWith('--sku='))?.split('=')[1] ?? null
const SKU_LIST = (process.argv.find((arg) => arg.startsWith('--sku-list='))?.split('=')[1] ?? '')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean)
const TARGETED_SKUS = new Set([...(ONLY_SKU ? [ONLY_SKU.toUpperCase()] : []), ...SKU_LIST])

function log(message: string): void {
  console.log(`[acer-en ${new Date().toISOString()}] ${message}`)
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

async function getStockRows(baseUrl: string, headers: HeadersInit): Promise<StockRow[]> {
  const res = await fetch(`${baseUrl}/api/warehouses/acer_store/stock?withProduct=1`, { headers })
  if (!res.ok) throw new Error(`Stock fetch failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data?: { stock?: StockRow[] } }
  return json.data?.stock ?? []
}

async function getProduct(baseUrl: string, headers: HeadersInit, sku: string): Promise<ProductDetail> {
  const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}`, { headers })
  if (!res.ok) throw new Error(`Product fetch ${sku} failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data: ProductDetail }
  return json.data
}

async function patchProduct(baseUrl: string, headers: HeadersInit, sku: string, fields: { title?: string; description?: string | null }): Promise<void> {
  const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/local`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      fields,
      triggeredBy: 'agent',
    }),
  })
  if (!res.ok) throw new Error(`PATCH ${sku} failed: ${res.status} ${await res.text()}`)
}

async function translateBatch(openAiKey: string, items: Array<{ sku: string; title: string; description: string | null }>): Promise<TranslationItem[]> {
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
          name: 'acer_main_field_translations',
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string' },
                    englishTitle: { type: 'string' },
                    englishDescription: { type: ['string', 'null'] },
                  },
                  required: ['sku', 'englishTitle', 'englishDescription'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'Translate Acer product main title and short description into clean, natural English.',
            'Preserve product facts exactly. Do not invent any specifications or marketing claims.',
            'Fix mixed-language text fully into English.',
            'Keep product model codes, sizes, storage, memory, refresh rates, and keyboard-layout markers exactly when present.',
            'Normalize decimal commas to decimal points.',
            'Preserve line breaks in descriptions.',
            'Return plain text only in the JSON fields.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({ items }),
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
  const parsed = JSON.parse(content) as { items: TranslationItem[] }
  return parsed.items
}

async function runConcurrent<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const queue = new Set<Promise<void>>()
  let index = 0
  for (const item of items) {
    const promise = fn(item, index).finally(() => queue.delete(promise))
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

  const apiHeaders: HeadersInit = {
    Authorization: `Bearer ${agentToken}`,
    'CF-Access-Client-Id': accessId,
    'CF-Access-Client-Secret': accessSecret,
  }

  const stockRows = await getStockRows(baseUrl, apiHeaders)
  const targets = stockRows
    .filter((row) => row.status === 'active' || row.status === 'archived')
    .filter((row) => row.imageCount > 0)
    .filter((row) => row.categoryCount > 0)
    .filter((row) => TARGETED_SKUS.size > 0 ? TARGETED_SKUS.has(row.productId.toUpperCase()) : true)

  log(`Targeting ${targets.length} ACER product(s)${DRY_RUN ? ' [dry-run]' : ''}`)

  const details: Array<{ sku: string; title: string; description: string | null }> = []
  for (const row of targets) {
    const product = await getProduct(baseUrl, apiHeaders, row.productId)
    details.push({
      sku: product.id,
      title: product.title,
      description: product.description,
    })
  }

  const batches: typeof details[] = []
  const batchSize = 12
  for (let i = 0; i < details.length; i += batchSize) {
    batches.push(details.slice(i, i + batchSize))
  }

  let changed = 0
  await runConcurrent(batches, CONCURRENCY, async (batch, index) => {
    const translated = await translateBatch(openAiKey, batch)
    for (const item of translated) {
      const current = details.find((entry) => entry.sku === item.sku)
      if (!current) continue
      const nextTitle = normalizeText(item.englishTitle)
      const nextDescription = normalizeText(item.englishDescription)
      if (!nextTitle) throw new Error(`Missing translated title for ${item.sku}`)
      const sameTitle = nextTitle === normalizeText(current.title)
      const sameDescription = nextDescription === normalizeText(current.description)
      if (sameTitle && sameDescription) continue

      if (DRY_RUN) {
        log(`dry-run ${item.sku}`)
        log(`  title: ${current.title} => ${nextTitle}`)
      } else {
        await patchProduct(baseUrl, apiHeaders, item.sku, {
          title: nextTitle,
          description: nextDescription,
        })
        log(`updated ${item.sku} (${index + 1}/${batches.length})`)
      }
      changed += 1
    }
  })

  log(`Done. changed=${changed} scanned=${details.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
