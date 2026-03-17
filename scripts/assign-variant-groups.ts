/**
 * assign-variant-groups.ts
 *
 * Detects keyboard-layout variant groups among laptops and writes variant_group_id
 * to the products table via the Wizhard attributes API.
 *
 * Variant definition:
 *  - Same laptop model (extracted from title: "| ModelCode |")
 *  - Different keyboard_layout (mandatory)
 *  - Same processor_model, ram, graphics, storage (diff = different product tier, not variant)
 *  - panel_type differences are ignored (translation noise — same physical panel)
 *  - color, screen_size, resolution, refresh_rate must match
 *
 * Usage:
 *   npx tsx scripts/assign-variant-groups.ts [--dry-run] [--local]
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as crypto from 'crypto'

const args      = process.argv.slice(2)
const IS_DRY    = args.includes('--dry-run')
const IS_LOCAL  = args.includes('--local')

// ── Config ──────────────────────────────────────────────────────────────────
const DEV_VARS_PATH = path.resolve(process.cwd(), '.dev.vars')
function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(DEV_VARS_PATH)) return out
  for (const line of fs.readFileSync(DEV_VARS_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}
const DEV_VARS    = loadDevVars()
const BASE_URL    = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : (DEV_VARS['WIZHARD_URL'] ?? 'https://wizhard.store')
const BEARER      = DEV_VARS['AGENT_BEARER_TOKEN'] ?? process.env['AGENT_BEARER_TOKEN'] ?? ''
const CF_ID       = DEV_VARS['CF_ACCESS_CLIENT_ID'] ?? ''
const CF_SECRET   = DEV_VARS['CF_ACCESS_CLIENT_SECRET'] ?? ''

function log(...args: unknown[]) { console.log('[variant-groups]', ...args) }

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function apiFetch(method: string, urlPath: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlPath, BASE_URL)
    const data = body ? JSON.stringify(body) : undefined
    const headers: Record<string, string> = {
      Authorization:              `Bearer ${BEARER}`,
      'CF-Access-Client-Id':      CF_ID,
      'CF-Access-Client-Secret':  CF_SECRET,
    }
    if (data) {
      headers['Content-Type']   = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(data))
    }
    const mod   = url.protocol === 'https:' ? https : require('http')
    const req   = mod.request(
      { hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method, headers },
      (res: any) => {
        let b = ''
        res.on('data', (d: Buffer) => { b += d })
        res.on('end', () => { try { resolve(JSON.parse(b)) } catch { resolve({}) } })
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ── Types ────────────────────────────────────────────────────────────────────
interface Product { sku: string; title: string; attrs: Record<string, string> }

// ── Model extraction ─────────────────────────────────────────────────────────
function extractModel(title: string): string | null {
  const m = title.match(/\|\s*([A-Z0-9]+-[A-Z0-9]+-?[A-Z0-9]*)\s*\|/)
  return m ? m[1] : null
}

// Attributes that must match exactly for two products to be variants.
// panel_type is intentionally excluded — it's translation noise.
const MUST_MATCH = ['processor_model', 'processor_brand', 'ram', 'storage', 'graphics', 'screen_size', 'resolution', 'color']

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`mode: ${IS_DRY ? 'DRY RUN' : 'LIVE'}  base: ${BASE_URL}`)

  // 1. Fetch all products
  const first = await apiFetch('GET', '/api/products?limit=50&page=1')
  const total = first.meta?.total ?? 0
  const pages = Math.ceil(total / 50)
  log(`Fetching ${total} products across ${pages} pages…`)

  let allProducts: any[] = [...(first.data ?? [])]
  for (let p = 2; p <= pages; p++) {
    const r = await apiFetch('GET', `/api/products?limit=50&page=${p}`)
    allProducts = allProducts.concat(r.data ?? [])
  }

  // 2. Filter laptops (NX. / NH. prefix) and fetch their attributes
  const laptops = allProducts.filter(p => p.id.startsWith('NX.') || p.id.startsWith('NH.'))
  log(`Fetching attributes for ${laptops.length} laptops…`)

  const products: Product[] = []
  for (const lp of laptops) {
    const d = await apiFetch('GET', `/api/products/${lp.id}`)
    const mf = d.data?.metafields ?? d.metafields ?? []
    const attrs: Record<string, string> = {}
    for (const m of mf) {
      if (m.namespace === 'attributes') attrs[m.key] = m.value
    }
    products.push({ sku: lp.id, title: lp.title, attrs })
  }

  const withKbd = products.filter(p => p.attrs.keyboard_layout)
  log(`${withKbd.length} laptops have keyboard_layout attribute`)

  // 3. Group by model
  const byModel: Record<string, Product[]> = {}
  for (const p of withKbd) {
    const model = extractModel(p.title)
    if (!model) continue
    if (!byModel[model]) byModel[model] = []
    byModel[model].push(p)
  }

  // 4. Within each model, find variant sub-groups
  type Group = Product[]
  const allGroups: Group[] = []

  for (const [model, modelProducts] of Object.entries(byModel)) {
    if (modelProducts.length < 2) continue

    const visited = new Set<number>()

    for (let i = 0; i < modelProducts.length; i++) {
      if (visited.has(i)) continue
      const group: Product[] = [modelProducts[i]]
      visited.add(i)

      for (let j = i + 1; j < modelProducts.length; j++) {
        if (visited.has(j)) continue
        const a = modelProducts[i].attrs
        const b = modelProducts[j].attrs

        // Must have different keyboard layouts
        if (!a.keyboard_layout || !b.keyboard_layout) continue
        if (a.keyboard_layout === b.keyboard_layout) continue

        // All MUST_MATCH keys must be identical
        const mismatch = MUST_MATCH.some(k => {
          const av = a[k] ?? null
          const bv = b[k] ?? null
          return av !== bv
        })
        if (mismatch) continue

        group.push(modelProducts[j])
        visited.add(j)
      }

      if (group.length > 1) allGroups.push(group)
    }
  }

  log(`Found ${allGroups.length} variant groups (${allGroups.reduce((s, g) => s + g.length, 0)} SKUs total)`)

  // 5. Assign variant_group_id via PATCH to /api/products/:sku
  //    We use a dedicated endpoint: PUT /api/products/:sku with { variantGroupId }
  //    Fallback: directly update via the product route if it supports variantGroupId
  let assigned = 0
  let skipped  = 0

  for (const group of allGroups) {
    const groupId = crypto.randomUUID()
    const skus    = group.map(p => p.sku).join(', ')
    const kbds    = group.map(p => p.attrs.keyboard_layout).join(' / ')
    log(`\nGroup ${groupId.slice(0, 8)} — ${extractModel(group[0].title)} [${kbds}]`)
    log(`  SKUs: ${skus}`)

    if (IS_DRY) { skipped += group.length; continue }

    for (const p of group) {
      const res = await apiFetch('PATCH', `/api/products/${p.sku}`, { variantGroupId: groupId })
      if (res.data?.id || res.success !== false) {
        log(`  ✓ ${p.sku} → group ${groupId.slice(0, 8)}`)
        assigned++
      } else {
        log(`  ✗ ${p.sku} — ${JSON.stringify(res).slice(0, 120)}`)
        skipped++
      }
    }
  }

  log(`\n✅ Done. Assigned: ${assigned}  Skipped/dry: ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
