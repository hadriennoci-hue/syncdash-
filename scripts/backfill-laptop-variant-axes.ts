import { readFile } from 'node:fs/promises'
import { deriveLaptopVariantAxes } from '@/lib/utils/laptop-variant-axes'

interface ProductRow {
  id: string
  title: string
  sourceUrl: string | null
  sourceName: string | null
}

interface AttributeRow {
  productId: string
  key: string
  value: string | null
  type: string | null
}

function parseEnv(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2].trim()])
  )
}

async function queryD1<T>(token: string, accountId: string, dbId: string, sql: string): Promise<T[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  })
  const json = await response.json() as {
    success: boolean
    errors?: Array<{ message: string }>
    result?: Array<{ results: T[] }>
  }
  if (!json.success) {
    throw new Error(json.errors?.map((error) => error.message).join('; ') ?? 'D1 query failed')
  }
  return json.result?.[0]?.results ?? []
}

async function apiPutAttributes(baseUrl: string, headers: HeadersInit, sku: string, attributes: Array<{ key: string; value: string; type: string }>): Promise<void> {
  const response = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/attributes`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      mode: 'merge',
      attributes,
      triggeredBy: 'agent',
    }),
  })
  if (!response.ok) {
    throw new Error(`PUT attributes ${sku} failed: ${response.status} ${await response.text()}`)
  }
}

async function main(): Promise<void> {
  const vars = parseEnv(await readFile('.dev.vars', 'utf8'))
  const cloudflareToken = vars.CLOUDFLARE_API_TOKEN
  const accountId = '22289f45fec4c8545c8a47f6d768cad9'
  const dbId = 'd7471ca2-fe58-4066-a946-367d062e7e95'
  const baseUrl = vars.NEXT_PUBLIC_APP_URL || 'https://wizhard.store'
  const headers: HeadersInit = {
    Authorization: `Bearer ${vars.AGENT_BEARER_TOKEN}`,
    'CF-Access-Client-Id': vars.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': vars.CF_ACCESS_CLIENT_SECRET,
  }

  const products = await queryD1<ProductRow>(cloudflareToken, accountId, dbId, `
    SELECT DISTINCT
      p.id,
      p.title,
      ws.source_url AS sourceUrl,
      ws.source_name AS sourceName
    FROM products p
    JOIN product_categories pc ON pc.product_id = p.id
    JOIN categories c ON c.id = pc.category_id
    LEFT JOIN warehouse_stock ws
      ON ws.product_id = p.id
     AND ws.warehouse_id = 'acer_store'
    WHERE c.slug = 'laptops'
    ORDER BY p.id
  `)

  const attributes = await queryD1<AttributeRow>(cloudflareToken, accountId, dbId, `
    SELECT
      product_id AS productId,
      key,
      value,
      type
    FROM product_metafields
    WHERE namespace = 'attributes'
      AND key IN ('keyboard_layout', 'color')
    ORDER BY product_id, key
  `)

  const attrMap = new Map<string, Record<string, AttributeRow>>()
  for (const attr of attributes) {
    const bucket = attrMap.get(attr.productId) ?? {}
    bucket[attr.key] = attr
    attrMap.set(attr.productId, bucket)
  }

  let scanned = 0
  let changed = 0
  for (const product of products) {
    scanned += 1
    const current = attrMap.get(product.id) ?? {}
    const derived = deriveLaptopVariantAxes({
      sourceUrl: product.sourceUrl,
      sourceName: product.sourceName,
      title: product.title,
      keyboardLayout: current.keyboard_layout?.value ?? null,
      color: current.color?.value ?? null,
    })

    const updates: Array<{ key: string; value: string; type: string }> = []
    if (derived.keyboardLayout && current.keyboard_layout?.value !== derived.keyboardLayout) {
      updates.push({ key: 'keyboard_layout', value: derived.keyboardLayout, type: current.keyboard_layout?.type ?? 'single_line_text_field' })
    }
    if (derived.color && current.color?.value !== derived.color) {
      updates.push({ key: 'color', value: derived.color, type: current.color?.type ?? 'single_line_text_field' })
    }

    if (updates.length === 0) continue
    await apiPutAttributes(baseUrl, headers, product.id, updates)
    changed += 1
    console.log(`[backfill] ${product.id} ${updates.map((update) => `${update.key}=${update.value}`).join(' ')}`)
  }

  console.log(`[backfill] scanned=${scanned} changed=${changed}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
