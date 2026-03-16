/**
 * fix-acer-stock-zeros.ts
 *
 * One-off: set all acer_store rows with quantity=0 to quantity=2.
 * Run once to backfill — future scrapes already fixed to always use 2.
 */

import * as fs from 'fs'
import * as path from 'path'

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

const DEV_VARS = readDevVars()
const args     = process.argv.slice(2)
const IS_LOCAL = args.includes('--local')
const IS_DRY   = args.includes('--dry-run')

const BASE_URL = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : (DEV_VARS['WIZHARD_URL'] ?? 'https://wizhard.store')
const TOKEN = process.env.AGENT_BEARER_TOKEN ?? DEV_VARS['AGENT_BEARER_TOKEN'] ?? ''
if (!TOKEN) { console.error('Missing AGENT_BEARER_TOKEN'); process.exit(1) }

const id     = DEV_VARS['CF_ACCESS_CLIENT_ID'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
const secret = DEV_VARS['CF_ACCESS_CLIENT_SECRET'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
  ...(id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {}),
}

function tsNow() { return new Date().toISOString() }
function log(m: string) { console.log(`[fix-stock ${tsNow()}] ${m}`) }

async function main() {
  log(`Target: ${BASE_URL}${IS_DRY ? ' (DRY RUN)' : ''}`)

  const res = await fetch(`${BASE_URL}/api/warehouses/acer_store/stock`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Stock fetch failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data: { stock: Array<{ productId: string; quantity: number }> } }
  const zeros = data.data.stock.filter(r => r.quantity === 0)
  log(`Found ${zeros.length} rows with quantity=0 out of ${data.data.stock.length} total`)

  if (IS_DRY) {
    zeros.forEach(r => log(`  [patch] ${r.productId}`))
    log(`Done (dry). would patch=${zeros.length}`)
    return
  }

  let patched = 0, errors = 0
  const CONCURRENCY = 8
  for (let i = 0; i < zeros.length; i += CONCURRENCY) {
    const batch = zeros.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async row => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await fetch(`${BASE_URL}/api/warehouses/acer_store/stock`, {
            method: 'PATCH',
            headers: HEADERS,
            body: JSON.stringify({ productId: row.productId, quantity: 2, triggeredBy: 'agent' }),
          })
          if (r.ok) { patched++; return }
          log(`  ERROR ${row.productId}: ${r.status} ${await r.text()}`); errors++; return
        } catch {
          if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt))
          else { log(`  TIMEOUT ${row.productId} after 3 attempts`); errors++ }
        }
      }
    }))
    log(`  progress: ${Math.min(i + CONCURRENCY, zeros.length)}/${zeros.length}`)
  }
  log(`Done. patched=${patched} errors=${errors}`)
}

main().catch(err => { console.error(err); process.exit(1) })
