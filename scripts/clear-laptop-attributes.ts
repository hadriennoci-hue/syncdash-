/**
 * clear-laptop-attributes.ts
 *
 * One-off script: wipe all scraped attributes for acer_store laptop products in production,
 * preserving only `keyboard_layout` (which is manually set).
 *
 * Usage:
 *   npx tsx scripts/clear-laptop-attributes.ts              → prod (WIZHARD_URL from .dev.vars)
 *   npx tsx scripts/clear-laptop-attributes.ts --local      → http://127.0.0.1:8787
 *   npx tsx scripts/clear-laptop-attributes.ts --dry-run    → list affected SKUs, no writes
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      const vars: Record<string, string> = {}
      for (const line of fs.readFileSync(candidate, 'utf-8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.+)$/)
        if (m) vars[m[1]] = m[2].trim()
      }
      return vars
    }
    dir = path.dirname(dir)
  }
  return {}
}

const DEV_VARS  = readDevVars()
const args      = process.argv.slice(2)
const IS_LOCAL  = args.includes('--local')
const IS_DRY    = args.includes('--dry-run')

const BASE_URL  = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : (DEV_VARS['WIZHARD_URL'] ?? 'https://wizhard.store')
const TOKEN     = process.env.AGENT_BEARER_TOKEN ?? DEV_VARS['AGENT_BEARER_TOKEN'] ?? ''

if (!TOKEN) { console.error('Missing AGENT_BEARER_TOKEN'); process.exit(1) }

function getAccessHeaders(): Record<string, string> {
  const id     = DEV_VARS['CF_ACCESS_CLIENT_ID'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const secret = DEV_VARS['CF_ACCESS_CLIENT_SECRET'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

function tsNow(): string { return new Date().toISOString() }
function log(msg: string): void { console.log(`[clear-attrs ${tsNow()}] ${msg}`) }

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
  ...getAccessHeaders(),
}

// ---------------------------------------------------------------------------
// Category detection (mirrors scrape-acer-images.ts logic)
// ---------------------------------------------------------------------------

function isLaptop(sourceName: string, sourceUrl: string): boolean {
  const u = (sourceUrl ?? '').toLowerCase()
  const n = (sourceName ?? '').toLowerCase()

  if (u.includes('laptop') || u.includes('notebook') || u.includes('ordinateur-portable')
   || u.includes('portables') || u.includes('ordenadores-portatiles')
   || u.includes('barbar')
   || u.includes('baerbar')
   || u.includes('b%c3%a4rbar') || u.includes('b%c3%a6rbar')
   || u.includes('kannettav')
   || u.includes('/portatil')
   || u.includes('/notebook')
  ) return true

  if (n.includes('ordinateur') || n.includes('portable') || n.includes('laptop')
   || n.includes('notebook') || n.includes('portátil') || n.includes('kannettava')
  ) return true

  return false
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface StockRow {
  productId:      string
  sourceUrl:      string | null
  sourceName:     string | null
  attributeCount: number
}

interface Attribute {
  namespace: string
  key:       string
  value:     string
}

async function fetchLaptopStockRows(): Promise<StockRow[]> {
  const res = await fetch(`${BASE_URL}/api/warehouses/acer_store/stock?withProduct=1`, {
    headers: AUTH_HEADERS,
  })
  if (!res.ok) throw new Error(`Stock fetch failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data: { stock: StockRow[] } }
  return (data.data?.stock ?? []).filter(r => isLaptop(r.sourceName ?? '', r.sourceUrl ?? ''))
}

async function fetchAttributes(sku: string): Promise<Attribute[]> {
  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}/attributes`, {
    headers: AUTH_HEADERS,
  })
  if (!res.ok) throw new Error(`GET attributes failed for ${sku}: ${res.status}`)
  const data = await res.json() as { data: Attribute[] }
  return data.data ?? []
}

async function replaceAttributes(sku: string, attributes: Attribute[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}/attributes`, {
    method: 'PUT',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ mode: 'replace', attributes, triggeredBy: 'agent' }),
  })
  if (!res.ok) throw new Error(`PUT attributes failed for ${sku}: ${res.status} ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Target: ${BASE_URL}${IS_DRY ? ' (DRY RUN)' : ''}`)

  log('Fetching acer_store laptop stock rows...')
  const rows = await fetchLaptopStockRows()
  log(`Found ${rows.length} laptop SKUs in acer_store`)

  let cleared = 0
  let skipped = 0
  let errors  = 0

  for (const row of rows) {
    const sku = row.productId

    if (row.attributeCount === 0) {
      log(`  [skip] ${sku} — no attributes`)
      skipped++
      continue
    }

    let attrs: Attribute[]
    try {
      attrs = await fetchAttributes(sku)
    } catch (err) {
      log(`  [error] ${sku} — ${err}`)
      errors++
      continue
    }

    const kbLayout = attrs.filter(a => a.key === 'keyboard_layout')
    const nonKb    = attrs.filter(a => a.key !== 'keyboard_layout')

    if (nonKb.length === 0) {
      log(`  [skip] ${sku} — only keyboard_layout present, nothing to clear`)
      skipped++
      continue
    }

    log(`  [clear] ${sku} — removing ${nonKb.length} attrs, keeping ${kbLayout.length} keyboard_layout`)

    if (IS_DRY) {
      skipped++
      continue
    }

    try {
      await replaceAttributes(sku, kbLayout)
      cleared++
    } catch (err) {
      log(`  [error] ${sku} — ${err}`)
      errors++
    }
  }

  log(`Done. cleared=${cleared} skipped=${skipped} errors=${errors}`)
}

main().catch(err => { console.error(err); process.exit(1) })
