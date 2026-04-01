#!/usr/bin/env npx tsx
/**
 * Patches storage_type, refresh_rate, panel_type, resolution
 * for all products whose title contains a known model code.
 *
 * Run: npx tsx scripts/patch-product-specs.ts
 */

const BASE_URL = 'https://wizhard.store'
const BEARER = 'B4Hv7O1ncBTgqQ7tmORy_vIR-lWZuHijNR0dh4Vwgh5GfgOszFI9NJFm9VPX-5ha'
const CF_ID = 'e71e1408e8a9ef8171697b2bccfedb4f.access'
const CF_SECRET = '1efe58e8ad07557570e5aea60074dfaf3428145601a22faf3a20c79d4a305ef1'

const HEADERS = {
  'Authorization': `Bearer ${BEARER}`,
  'CF-Access-Client-Id': CF_ID,
  'CF-Access-Client-Secret': CF_SECRET,
  'Content-Type': 'application/json',
}

// ─── Spec map ────────────────────────────────────────────────────────────────
// Key: substring to match in product title (case-insensitive)
// Value: attributes to set
type Attrs = { storage_type?: string; refresh_rate?: string; panel_type?: string; resolution?: string }

const SPEC_MAP: Array<{ match: string; attrs: Attrs }> = [
  // Laptops — storage_type
  { match: 'SF16-51',       attrs: { storage_type: 'NVMe SSD', refresh_rate: '120' } },
  { match: 'SFG14-75',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFG14-64',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFG14-63',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFG16-74',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFG14-73',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFG16-72',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SF14-11',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'SFX14-72G',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'A14-51M',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'A15-51M',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'A16-71GM',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'A17-51M',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'A17-51GM',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AG15-72P',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AG15-71P',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AG15-42P',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AG16-71P',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AGSP14-31PT',   attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ASP14-52MTN',   attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ANV15-51',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ANV15-52',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ANV16-42',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ANV16S-61',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'ANV17-41',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'AN18-61',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'TMP215-55',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'TMP414RN-55',   attrs: { storage_type: 'NVMe SSD' } },
  { match: 'TMP614-73',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'PHN14-71',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'PHN16-73',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'PHN16S-71',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'PH18-73',       attrs: { storage_type: 'NVMe SSD' } },
  // Desktops
  { match: 'XC-1785',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'XC-1860',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'C24-195ES',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'C24-1300',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'C27-195ES',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'C27-1800',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'VN4710GT',      attrs: { storage_type: 'NVMe SSD' } },
  { match: 'VVN4720GT',     attrs: { storage_type: 'NVMe SSD' } },
  { match: 'N50-660',       attrs: { storage_type: 'NVMe SSD' } },
  { match: 'PO7-660',       attrs: { storage_type: 'NVMe SSD' } },
  // Monitors — refresh_rate
  { match: 'SA242YH1',      attrs: { refresh_rate: '100' } },
  { match: 'XF240YP6',      attrs: { refresh_rate: '144' } },
  { match: 'XF240YW3',      attrs: { refresh_rate: '240' } },
  { match: 'XF240Y P6',     attrs: { refresh_rate: '144' } },
  { match: 'XF240Y W3',     attrs: { refresh_rate: '240' } },
  { match: 'XF270P6',       attrs: { refresh_rate: '144' } },
  { match: 'XF270W3',       attrs: { refresh_rate: '240' } },
  { match: 'XF270 P6',      attrs: { refresh_rate: '144' } },
  { match: 'XF270 W3',      attrs: { refresh_rate: '240' } },
  { match: 'XV272UV3',      attrs: { refresh_rate: '180' } },
  { match: 'XV272U V3',     attrs: { refresh_rate: '180' } },
  { match: 'ED320QUS3',     attrs: { refresh_rate: '180' } },
  { match: 'ED320QU S3',    attrs: { refresh_rate: '180' } },
  { match: 'KG241YP3',      attrs: { refresh_rate: '180' } },
  { match: 'KG241Y P3',     attrs: { refresh_rate: '180' } },
  { match: 'EK271P6',       attrs: { refresh_rate: '144' } },
  { match: 'EK271 P6',      attrs: { refresh_rate: '144' } },
  { match: 'CB241Y',        attrs: { refresh_rate: '75' } },
  { match: 'CB272P6',       attrs: { refresh_rate: '144' } },
  { match: 'CB272 P6',      attrs: { refresh_rate: '144' } },
  { match: 'CB272D6',       attrs: { refresh_rate: '120' } },
  { match: 'CB272 D6',      attrs: { refresh_rate: '120' } },
  // Predator Z57 — full specs
  { match: 'Z57',           attrs: { resolution: '7680x2160', refresh_rate: '120', panel_type: 'Mini LED' } },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getProducts(): Promise<Array<{ id: string; title: string }>> {
  let page = 1
  const all: Array<{ id: string; title: string }> = []
  while (true) {
    const res = await fetch(`${BASE_URL}/api/products?page=${page}&limit=50`, { headers: HEADERS })
    const json = await res.json() as { data?: Array<{ id: string; title: string }>; error?: string }
    if (!res.ok || !json.data || json.data.length === 0) break
    all.push(...json.data)
    if (json.data.length < 50) break
    page++
  }
  return all
}

function matchSpec(title: string): Attrs | null {
  const t = title.toLowerCase()
  const merged: Attrs = {}
  for (const { match, attrs } of SPEC_MAP) {
    if (t.includes(match.toLowerCase())) {
      Object.assign(merged, attrs)
    }
  }
  return Object.keys(merged).length ? merged : null
}

async function patchAttributes(sku: string, attrs: Attrs): Promise<boolean> {
  const attributes = Object.entries(attrs).map(([key, value]) => ({ key, value: value ?? null }))
  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}/attributes`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ mode: 'merge', attributes, triggeredBy: 'agent' }),
  })
  return res.ok
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching products...')
  const products = await getProducts()
  console.log(`Found ${products.length} products`)

  let updated = 0, skipped = 0, failed = 0

  for (const product of products) {
    const attrs = matchSpec(product.title)
    if (!attrs) { skipped++; continue }

    const ok = await patchAttributes(product.id, attrs)
    if (ok) {
      console.log(`✓ ${product.id} — ${product.title.slice(0, 60)}`)
      console.log(`  → ${JSON.stringify(attrs)}`)
      updated++
    } else {
      console.error(`✗ FAILED ${product.id} — ${product.title.slice(0, 60)}`)
      failed++
    }

    // small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 80))
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${failed} failed`)
}

main().catch(console.error)
