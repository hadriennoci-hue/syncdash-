#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { CoincartConnector } from '@/lib/connectors/coincart'
import { ShopifyConnector } from '@/lib/connectors/shopify'
import type { Platform } from '@/types/platform'

interface ProductListRow {
  id: string
  supplier?: { id?: string | null } | null
}

interface ProductCollection {
  slug: string | null
}

interface ProductMetafield {
  namespace: string
  key: string
  value: string | null
}

interface ProductDetail {
  id: string
  title: string
  createdAt: string
  collections: ProductCollection[]
  metafields: ProductMetafield[]
}

interface MappingRow {
  productId: string
  platform: TargetPlatform
  platformId: string
}

const RECENT_SINCE = '2026-04-29'
const TARGET_PLATFORMS = ['shopify_komputerzz', 'coincart2'] as const
type TargetPlatform = (typeof TARGET_PLATFORMS)[number]

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      return Object.fromEntries(
        fs.readFileSync(candidate, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => [match[1], match[2].trim()])
      )
    }
    dir = path.dirname(dir)
  }
  return {}
}

for (const [key, value] of Object.entries(readDevVars())) {
  if (!process.env[key]) process.env[key] = value
}

const baseUrl = process.env.WIZHARD_URL ?? 'https://wizhard.store'
const bearer = process.env.AGENT_BEARER_TOKEN ?? ''

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
  }
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    out['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
    out['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  }
  return { ...out, ...extra }
}

async function apiGet<T>(pathname: string): Promise<T> {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: headers() })
  if (!response.ok) throw new Error(`GET ${pathname} -> ${response.status} ${await response.text()}`)
  const json = await response.json() as { data: T }
  return json.data
}

async function fetchShopifyAccessToken(): Promise<string> {
  const shop = process.env.SHOPIFY_KOMPUTERZZ_SHOP ?? ''
  const clientId = process.env.SHOPIFY_KOMPUTERZZ_CLIENT_ID ?? ''
  const clientSecret = process.env.SHOPIFY_KOMPUTERZZ_CLIENT_SECRET ?? ''
  if (!shop || !clientId || !clientSecret) {
    throw new Error('Missing Shopify Komputerzz OAuth credentials')
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  if (!response.ok) throw new Error(`Shopify OAuth ${response.status}: ${await response.text()}`)
  const json = await response.json() as { access_token?: string }
  if (!json.access_token) throw new Error('Shopify OAuth returned no access_token')
  return json.access_token
}

function splitAttributeValues(raw: string): string[] {
  return raw
    .split(/[|,;]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function collectAttributeValues(product: ProductDetail): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const metafield of product.metafields) {
    if (metafield.namespace !== 'attributes') continue
    const key = metafield.key.trim().toLowerCase()
    const raw = (metafield.value ?? '').trim()
    if (!key || !raw) continue
    out[key] = Array.from(new Set(splitAttributeValues(raw)))
  }
  return out
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
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

async function main(): Promise<void> {
  if (!bearer) throw new Error('AGENT_BEARER_TOKEN missing')

  const [rows, komputerzzMappings, coincartMappings] = await Promise.all([
    apiGet<ProductListRow[]>('/api/products?page=1&perPage=1000'),
    apiGet<MappingRow[]>('/api/mappings?platform=shopify_komputerzz'),
    apiGet<MappingRow[]>('/api/mappings?platform=coincart2'),
  ])

  const mappingByPlatform = new Map<TargetPlatform, Map<string, string>>()
  mappingByPlatform.set(
    'shopify_komputerzz',
    new Map(komputerzzMappings.map((row) => [row.productId, row.platformId]))
  )
  mappingByPlatform.set(
    'coincart2',
    new Map(coincartMappings.map((row) => [row.productId, row.platformId]))
  )

  const recentAcerRows = rows.filter((row) => row.supplier?.id === 'acer')
  const products = await mapLimit(
    recentAcerRows,
    8,
    (row) => apiGet<ProductDetail>(`/api/products/${encodeURIComponent(row.id)}`),
  )
  const recentProducts = products.filter((product) => product.createdAt >= RECENT_SINCE)

  const shopifyAccessToken = await fetchShopifyAccessToken()
  const connectorCache = new Map<TargetPlatform, CoincartConnector | ShopifyConnector>([
    [
      'shopify_komputerzz',
      new ShopifyConnector(
        process.env.SHOPIFY_KOMPUTERZZ_SHOP!,
        shopifyAccessToken,
        process.env.SHOPIFY_KOMPUTERZZ_LOCATION_ID,
      ),
    ],
    [
      'coincart2',
      new CoincartConnector(
        process.env.COINCART_URL!,
        process.env.COINCART_KEY!,
        process.env.COINCART_SECRET!,
        process.env.COINCART_API_URL,
      ),
    ],
  ])
  const summary: Record<'shopify_komputerzz' | 'coincart2', { attempted: number; synced: number; failed: Array<{ sku: string; message: string }> }> = {
    shopify_komputerzz: { attempted: 0, synced: 0, failed: [] },
    coincart2: { attempted: 0, synced: 0, failed: [] },
  }

  for (const product of recentProducts) {
    const attributeValues = collectAttributeValues(product)
    if (Object.keys(attributeValues).length === 0) continue

    for (const platform of TARGET_PLATFORMS) {
      const platformId = mappingByPlatform.get(platform)?.get(product.id)
      if (!platformId) continue
      summary[platform].attempted += 1

      try {
        const connector = connectorCache.get(platform)!
        if (platform === 'shopify_komputerzz') {
          const shopifyConnector = connector as ShopifyConnector & {
            syncProductAttributeMetafields?: (platformId: string, attributes: Record<string, string[]>) => Promise<void>
          }
          if (typeof shopifyConnector.syncProductAttributeMetafields !== 'function') {
            throw new Error('Shopify attribute metafield sync is not available')
          }
          await shopifyConnector.syncProductAttributeMetafields(platformId, attributeValues)
        } else {
          await connector.updateProduct(platformId, { attributeValues })
        }
        summary[platform].synced += 1
        console.log(`[synced] ${platform} ${product.id}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        summary[platform].failed.push({ sku: product.id, message })
        console.error(`[failed] ${platform} ${product.id}: ${message}`)
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
