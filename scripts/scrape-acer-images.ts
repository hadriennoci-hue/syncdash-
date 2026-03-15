/**
 * scrape-acer-images.ts
 *
 * Local runner: scrapes Acer Store product pages with Playwright (real Chrome),
 * downloads all gallery images as binary, uploads to R2 via Wizhard upload API.
 * Stores final R2 URLs in D1 product_images table.
 *
 * Usage:
 *   npx tsx scripts/scrape-acer-images.ts              → prod (WIZHARD_URL from .dev.vars)
 *   npx tsx scripts/scrape-acer-images.ts --local      → http://127.0.0.1:8787
 *   npx tsx scripts/scrape-acer-images.ts --dry-run    → list products, no browser
 *   npx tsx scripts/scrape-acer-images.ts --sku=GP.HDS11.02D  → single product
 *   npx tsx scripts/scrape-acer-images.ts --mode=add   → append (default: replace)
 */

import { chromium, type Browser, type BrowserContext } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

const DEV_VARS   = readDevVars()
const args       = process.argv.slice(2)
const IS_LOCAL   = args.includes('--local')
const IS_DRY_RUN = args.includes('--dry-run')
const IS_HEADED  = args.includes('--headed')
const MODE       = (args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'replace') as 'replace' | 'add'
const ONLY_SKU   = args.find(a => a.startsWith('--sku='))?.split('=')[1] ?? null
const CONCURRENCY = 2  // simultaneous product pages — keep low to avoid rate limits

const BASE_URL = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : (DEV_VARS['WIZHARD_URL'] ?? 'https://wizhard.store')
const TOKEN = process.env.AGENT_BEARER_TOKEN ?? DEV_VARS['AGENT_BEARER_TOKEN'] ?? ''

function getAccessHeaders(): Record<string, string> {
  const id     = DEV_VARS['CF_ACCESS_CLIENT_ID'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const secret = DEV_VARS['CF_ACCESS_CLIENT_SECRET'] ?? DEV_VARS['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

function tsNow(): string { return new Date().toISOString() }
function log(msg: string): void { console.log(`[acer-img ${tsNow()}] ${msg}`) }

// ---------------------------------------------------------------------------
// Wizhard API helpers
// ---------------------------------------------------------------------------

interface StockRow {
  productId: string
  sourceUrl:  string | null
  sourceName: string | null
  quantity:   number | null
}

async function getAcerStockRows(): Promise<StockRow[]> {
  const res = await fetch(`${BASE_URL}/api/warehouses/acer_store/stock`, {
    headers: { Authorization: `Bearer ${TOKEN}`, ...getAccessHeaders() },
  })
  if (!res.ok) throw new Error(`Failed to fetch acer_store stock: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data: { stock: StockRow[] } }
  return json.data?.stock ?? []
}

async function uploadImages(
  sku: string,
  files: Array<{ buffer: Buffer; filename: string; mimeType: string; alt: string }>,
  mode: 'replace' | 'add',
): Promise<{ urls: string[]; errors: string[] }> {
  const form = new FormData()
  form.append('mode', mode)
  form.append('triggeredBy', 'agent')

  for (const [i, f] of files.entries()) {
    form.append('files', new Blob([f.buffer], { type: f.mimeType }), f.filename)
    form.append(`alt_${i}`, f.alt)
  }

  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}/images/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, ...getAccessHeaders() },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upload API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<{ urls: string[]; errors: string[] }>
}

// ---------------------------------------------------------------------------
// Acer Store DOM scraper
// ---------------------------------------------------------------------------

/** Extract all product image CDN URLs from the current page (strips query params) */
async function extractImageUrls(
  context: BrowserContext,
  productUrl: string,
): Promise<Array<{ url: string; alt: string }>> {
  const page = await context.newPage()
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1_200)

    return await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-src],[src]'))
        .map(el => ({
          rawUrl: el.getAttribute('data-src') || (el as HTMLImageElement).src || '',
          alt:    (el as HTMLImageElement).alt || '',
        }))
        .filter(i => i.rawUrl.includes('catalog/product'))
        .map(i => {
          try {
            const u = new URL(i.rawUrl.split(' ')[0])
            u.search = ''
            return { url: u.href, alt: i.alt }
          } catch { return null }
        })
        .filter((i): i is { url: string; alt: string } => i !== null)
        .filter((v, idx, arr) => arr.findIndex(x => x.url === v.url) === idx)
    })
  } finally {
    await page.close()
  }
}

// ---------------------------------------------------------------------------
// Download image → Buffer
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    const mimeType = ct.split(';')[0].trim()
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, mimeType }
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Process one product
// ---------------------------------------------------------------------------

async function processProduct(
  context: BrowserContext,
  sku: string,
  sourceUrl: string,
  index: number,
  total: number,
): Promise<{ ok: number; skipped: number; errors: string[] }> {
  log(`[${index}/${total}] ${sku} → ${sourceUrl}`)

  const imageRefs = await extractImageUrls(context, sourceUrl)
  if (imageRefs.length === 0) {
    log(`  ⚠️  No images found`)
    return { ok: 0, skipped: 0, errors: ['No images found on page'] }
  }
  log(`  Found ${imageRefs.length} image(s)`)

  // Download all images in parallel
  const downloads = await Promise.all(
    imageRefs.map(async (ref, i) => {
      const result = await downloadImage(ref.url)
      if (!result) return null
      const ext = ref.url.split('.').pop()?.split('?')[0] ?? 'jpg'
      return {
        buffer:   result.buffer,
        mimeType: result.mimeType,
        filename: `${sku}-${i}.${ext}`,
        alt:      ref.alt || sku,
      }
    })
  )

  const files = downloads.filter((d): d is NonNullable<typeof d> => d !== null)
  const skipped = downloads.length - files.length
  if (files.length === 0) {
    log(`  ❌ All downloads failed`)
    return { ok: 0, skipped, errors: ['All image downloads failed'] }
  }

  // Upload to R2 via Wizhard API (in batches of 10 to stay well within limits)
  const errors: string[] = []
  let uploaded = 0
  const BATCH = 10
  for (let b = 0; b < files.length; b += BATCH) {
    const batch = files.slice(b, b + BATCH)
    const batchMode = b === 0 ? MODE : 'add'  // first batch respects mode, rest always append
    try {
      const result = await uploadImages(sku, batch, batchMode)
      uploaded += result.urls.length
      if (result.errors.length > 0) errors.push(...result.errors)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  log(`  ✅ ${uploaded}/${files.length} uploaded to R2${skipped > 0 ? `, ${skipped} download failures` : ''}`)
  return { ok: uploaded, skipped, errors }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runConcurrent<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []
  for (const task of tasks) {
    const p = task().then(r => { results.push(r) }).finally(() => {
      executing.splice(executing.indexOf(p), 1)
    })
    executing.push(p)
    if (executing.length >= limit) await Promise.race(executing)
  }
  await Promise.all(executing)
  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

;(async () => {
  if (!TOKEN) {
    log('❌ AGENT_BEARER_TOKEN not set in .dev.vars')
    process.exit(1)
  }

  log(`Target: ${BASE_URL}  mode: ${MODE}${ONLY_SKU ? `  sku: ${ONLY_SKU}` : ''}`)

  // Step 1 — fetch acer_store stock to get all sourceUrls
  log('Fetching acer_store stock list...')
  const allRows = await getAcerStockRows()
  const rows = allRows
    .filter(r => r.sourceUrl && r.sourceUrl !== 'null')
    .filter(r => !ONLY_SKU || r.productId === ONLY_SKU)

  if (rows.length === 0) {
    log('No products with Acer Store source URLs found.')
    process.exit(0)
  }
  log(`Found ${rows.length} product(s) with Acer source URLs`)

  if (IS_DRY_RUN) {
    rows.forEach(r => log(`  ${r.productId}  →  ${r.sourceUrl}`))
    process.exit(0)
  }

  // Step 2 — launch real Chrome (avoids Acer bot detection)
  const browser: Browser = await chromium.launch({
    channel: 'chrome',
    headless: !IS_HEADED,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  })

  // Step 3 — process each product
  let totalOk = 0
  let totalErrors = 0
  let i = 0

  const tasks = rows.map(row => async () => {
    const idx = ++i
    try {
      const result = await processProduct(context, row.productId, row.sourceUrl!, idx, rows.length)
      totalOk += result.ok
      totalErrors += result.errors.length
    } catch (err) {
      log(`  ❌ ${row.productId}: ${err instanceof Error ? err.message : err}`)
      totalErrors++
    }
  })

  await runConcurrent(tasks, CONCURRENCY)
  await browser.close()

  log(`\n✅ Done — ${totalOk} images uploaded, ${totalErrors} errors`)
})()
