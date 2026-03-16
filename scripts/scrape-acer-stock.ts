/**
 * scrape-acer-stock.ts
 *
 * Local Playwright runner — replaces Firecrawl for Acer Store product/stock discovery.
 * Crawls all 6 category pages, extracts SKU + name + URL + price + stock status,
 * then POSTs to POST /api/warehouses/acer_store/ingest to write to D1.
 *
 * Usage:
 *   npx tsx scripts/scrape-acer-stock.ts              → prod (WIZHARD_URL from .dev.vars)
 *   npx tsx scripts/scrape-acer-stock.ts --local      → http://127.0.0.1:8787
 *   npx tsx scripts/scrape-acer-stock.ts --dry-run    → print scraped data, no API call
 *   npx tsx scripts/scrape-acer-stock.ts --headed     → show browser window
 */

import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Default category URLs — overridden by ACER_STORE_SCRAPE_URLS in .dev.vars
// Format in .dev.vars: comma-separated list of full URLs
// ACER_STORE_SCRAPE_URLS=https://store.acer.com/fr-fr/ecrans,https://store.acer.com/fr-fr/ordinateurs-portables
const DEFAULT_CATEGORY_URLS = [
  'https://store.acer.com/fr-fr/ordinateurs-portables',
  'https://store.acer.com/fr-fr/ordinateurs-de-bureau',
  'https://store.acer.com/fr-fr/ecrans',
  'https://store.acer.com/fr-fr/peripheriques',
  'https://store.acer.com/fr-fr/accessoires',
  'https://store.acer.com/fr-fr/gaming',
]

// Non-hardware items that appear on the store but are not physical products
const BLOCKED_NAME_TOKENS = ['trouver', 'réparation', 'mcafee', 'garantie', 'recovery', 'service']

function readDevVars(): Record<string, string> {
  // Walk up from cwd to find .dev.vars (handles worktree vs main repo)
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

const DEV_VARS    = readDevVars()
const args        = process.argv.slice(2)
const IS_LOCAL    = args.includes('--local')
const IS_DRY      = args.includes('--dry-run')
const IS_HEADED   = args.includes('--headed')
// --category=ecrans  (matches any part of the URL slug)
const ONLY_CAT    = args.find(a => a.startsWith('--category='))?.split('=')[1] ?? null

// URLs from .dev.vars override the defaults — easy to extend without touching code
const envUrls = (DEV_VARS['ACER_STORE_SCRAPE_URLS'] ?? process.env['ACER_STORE_SCRAPE_URLS'] ?? '')
  .split(',')
  .map(u => u.trim())
  .filter(u => u.startsWith('http'))
const CATEGORY_URLS = envUrls.length > 0 ? envUrls : DEFAULT_CATEGORY_URLS

const BASE_URL = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : (DEV_VARS['WIZHARD_URL'] ?? 'https://wizhard.store')
const TOKEN = DEV_VARS['AGENT_BEARER_TOKEN'] ?? ''

function getAccessHeaders(): Record<string, string> {
  const id     = DEV_VARS['CF_ACCESS_CLIENT_ID'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const secret = DEV_VARS['CF_ACCESS_CLIENT_SECRET'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

function tsNow(): string { return new Date().toISOString() }
function log(msg: string): void { console.log(`[acer-stock ${tsNow()}] ${msg}`) }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AcerProduct {
  sku:              string
  name:             string
  url:              string
  price:            number | null
  promoPrice:       number | null   // final discounted price (price minus discount), or null
  inStock:          boolean
}

// ---------------------------------------------------------------------------
// DOM extraction — runs inside the browser page
// ---------------------------------------------------------------------------

function extractProductsFromPage(): AcerProduct[] {
  const items = Array.from(document.querySelectorAll<HTMLElement>('li.item.product.product-item'))
  const results: AcerProduct[] = []

  for (const el of items) {
    const nameEl  = el.querySelector<HTMLAnchorElement>('.product-item-name a')
    const skuEl   = el.querySelector<HTMLElement>('.sku-wrapper')
    const priceEl = el.querySelector<HTMLElement>('[data-price-type="finalPrice"]')
    const oldPriceEl = el.querySelector<HTMLElement>('[data-price-type="oldPrice"]')
    const stockEl = el.querySelector<HTMLElement>('[class*="stock"]')

    if (!nameEl || !skuEl) continue

    // SKU: "Réf.\n            \n                HP.EXPBG.019" → extract pattern
    const skuRaw = skuEl.textContent ?? ''
    const skuMatch = skuRaw.match(/([A-Z]{2}\.[A-Z0-9]+\.[A-Z0-9]+)/)
    const sku = skuMatch ? skuMatch[1] : ''
    if (!sku) continue

    const name = nameEl.textContent?.trim() ?? ''
    const url  = nameEl.href?.split('?')[0] ?? ''

    const price = priceEl
      ? parseFloat(priceEl.getAttribute('data-price-amount') ?? '') || null
      : null

    // oldPrice is present when a discount is applied (e.g., "€39.90" → "€29.90")
    const oldPrice = oldPriceEl
      ? parseFloat(oldPriceEl.getAttribute('data-price-amount') ?? '') || null
      : null

    // promoPrice = discounted final price when oldPrice exists, otherwise null
    const promoPrice = oldPrice !== null && price !== null && oldPrice > price ? price : null
    const importPrice = oldPrice !== null && promoPrice !== null ? oldPrice : price

    const stockText = stockEl?.textContent?.toLowerCase() ?? ''
    const inStock = stockText.includes('en stock') || (!stockText.includes('rupture') && !stockText.includes('indisponible'))

    results.push({ sku, name, url, price: importPrice, promoPrice, inStock })
  }

  return results
}

// ---------------------------------------------------------------------------
// Crawl one category (all pages)
// ---------------------------------------------------------------------------

async function crawlCategory(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>,
  categoryUrl: string,
): Promise<AcerProduct[]> {
  const all: AcerProduct[] = []
  let current: string | null = categoryUrl
  let pageNum = 1

  while (current) {
    log(`  📄 page ${pageNum}: ${current}`)
    await page.goto(current, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1_500)

    const products = await page.evaluate(extractProductsFromPage)
    log(`    → ${products.length} products`)
    all.push(...products)

    const nextLink = await page.$('a.action.next, li.item.pages-item-next a')
    current = nextLink ? await nextLink.getAttribute('href') : null
    pageNum++
  }

  return all
}

// ---------------------------------------------------------------------------
// POST snapshots to Wizhard ingest endpoint
// ---------------------------------------------------------------------------

interface Snapshot {
  sku:              string
  quantity:         number
  sourceUrl:        string
  sourceName:       string
  importPrice:      number | null
  importPromoPrice: number | null
}

async function ingestSnapshots(snapshots: Snapshot[]): Promise<void> {
  // Send in batches of 500 to stay within Cloudflare Worker request size limits
  const BATCH = 500
  for (let i = 0; i < snapshots.length; i += BATCH) {
    const batch = snapshots.slice(i, i + BATCH)
    const res = await fetch(`${BASE_URL}/api/warehouses/acer_store/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        ...getAccessHeaders(),
      },
      body: JSON.stringify({ snapshots: batch, triggeredBy: 'agent' }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ingest API error ${res.status}: ${text}`)
    }
    const result = await res.json() as { data: { productsUpdated: number; errors: string[] } }
    log(`  ✅ Batch ${Math.floor(i / BATCH) + 1}: ${result.data.productsUpdated} updated, ${result.data.errors.length} errors`)
    if (result.data.errors.length > 0) {
      result.data.errors.slice(0, 5).forEach(e => log(`    ⚠️  ${e}`))
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  if (!TOKEN && !IS_DRY) {
    log('❌ AGENT_BEARER_TOKEN not set in .dev.vars')
    process.exit(1)
  }

  const categoriesToRun = ONLY_CAT
    ? CATEGORY_URLS.filter(u => u.includes(ONLY_CAT))
    : CATEGORY_URLS

  if (categoriesToRun.length === 0) {
    // Show the locale/slug portion (e.g. "fr-fr/ecrans", "de-de/monitore") so the hint is unambiguous
    log(`❌ No category matched "--category=${ONLY_CAT}". Available:\n  ${CATEGORY_URLS.map(u => u.replace('https://store.acer.com/', '')).join('\n  ')}`)
    process.exit(1)
  }

  log(`Target: ${BASE_URL}${IS_DRY ? '  [DRY RUN]' : ''}  categories: ${categoriesToRun.map(u => u.split('/').pop()).join(', ')}`)

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !IS_HEADED,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  })
  const page = await context.newPage()

  const seen = new Set<string>()
  const allProducts: AcerProduct[] = []

  for (const catUrl of categoriesToRun) {
    log(`\n📂 ${catUrl}`)
    try {
      const products = await crawlCategory(page, catUrl)
      for (const p of products) {
        if (seen.has(p.sku)) continue
        const nameLower = p.name.toLowerCase()
        if (BLOCKED_NAME_TOKENS.some(t => nameLower.includes(t))) continue
        seen.add(p.sku)
        allProducts.push(p)
      }
      log(`  → running total: ${allProducts.length} unique products`)
    } catch (err) {
      log(`  ❌ Failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  await browser.close()

  log(`\n📦 Total unique products scraped: ${allProducts.length}`)

  if (IS_DRY) {
    allProducts.slice(0, 10).forEach(p =>
      log(`  ${p.sku}  |  ${p.name}  |  ${p.price}€${p.promoPrice ? ` → ${p.promoPrice}€` : ''}  |  ${p.inStock ? 'inStock' : 'OUT'}  |  ${p.url}`)
    )
    if (allProducts.length > 10) log(`  ... and ${allProducts.length - 10} more`)
    process.exit(0)
  }

  // Convert to WarehouseStockSnapshot format
  const snapshots: Snapshot[] = allProducts.map(p => ({
    sku:              p.sku,
    quantity:         p.inStock ? 2 : 0,
    sourceUrl:        p.url,
    sourceName:       p.name,
    importPrice:      p.price,
    importPromoPrice: p.promoPrice,
  }))

  log(`\n📤 Ingesting ${snapshots.length} snapshots into ${BASE_URL}...`)
  await ingestSnapshots(snapshots)

  log('\n✅ Done')
})()
