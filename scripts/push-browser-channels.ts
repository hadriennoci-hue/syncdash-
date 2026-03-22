/**
 * push-browser-channels.ts â€” Push queued products to Libre Market and XMR Bazaar
 *
 * Queries Wizhard API for products with pushed status = '2push', automates
 * the browser to create or edit each listing, then marks them as done in D1.
 *
 * Usage:
 *   npx tsx scripts/push-browser-channels.ts              â†’ prod API (WIZHARD_URL from .dev.vars)
 *   npx tsx scripts/push-browser-channels.ts --local      â†’ http://127.0.0.1:8787
 *   npx tsx scripts/push-browser-channels.ts --dry-run    â†’ list queued products, no browser
 *   npx tsx scripts/push-browser-channels.ts --platform libre_market
 *   npx tsx scripts/push-browser-channels.ts --platform xmr_bazaar
 */

import { chromium, type Page } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readDevVars(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), '.dev.vars'),
    path.resolve(__dirname, '..', '.dev.vars'),
  ]
  const envPath = candidates.find((p) => fs.existsSync(p))
  if (!envPath) throw new Error(`.dev.vars not found (checked: ${candidates.join(', ')})`)

  const content = fs.readFileSync(envPath, 'utf-8')
  const vars: Record<string, string> = {}
  for (const raw of content.split('\n')) {
    const line = raw.replace('\uFEFF', '').trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) vars[m[1]] = m[2].trim()
  }
  return vars
}
const DEV_VARS = readDevVars()

function getAccessHeaders(vars: Record<string, string>): Record<string, string> {
  const clientId = vars['CF_ACCESS_CLIENT_ID'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const clientSecret = vars['CF_ACCESS_CLIENT_SECRET'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!clientId || !clientSecret) return {}
  return {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
  }
}

const args          = process.argv.slice(2)
const IS_LOCAL      = args.includes('--local')
const IS_DRY_RUN    = args.includes('--dry-run')
const IS_HEADLESS   = args.includes('--headless')
const ONLY_PLATFORM = args.find((a) => a.startsWith('--platform='))?.split('=')[1]
  ?? (args[args.indexOf('--platform') + 1] !== undefined && !args[args.indexOf('--platform') + 1].startsWith('--')
    ? args[args.indexOf('--platform') + 1]
    : null)

// ---------------------------------------------------------------------------
// Wizhard API client
// ---------------------------------------------------------------------------

interface ProductImage  { url: string; position: number; alt: string | null }
interface ProductDetail {
  id:          string
  title:       string
  description: string | null
  images:      ProductImage[]
  prices:      Record<string, { price: number | null; compareAt: number | null } | undefined>
  platforms:   Record<string, { platformId: string; syncStatus: string } | undefined>
}
interface ChannelProductSummary {
  sku: string
  platformId: string | null
  stock: { ireland: number | null; acer_store: number | null; poland: number | null }
}
interface BrowserRunReport {
  platform: 'libre_market' | 'xmr_bazaar'
  queued: number
  processed: number
  created: number
  updated: number
  failed: number
  errors: string[]
  dryRun: boolean
}

async function apiFetch(method: string, apiPath: string, body: unknown, token: string, base: string): Promise<Response> {
  return fetch(`${base}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...getAccessHeaders(DEV_VARS),
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  })
}

async function getQueuedSkus(platform: string, token: string, base: string): Promise<string[]> {
  const res = await apiFetch('GET', `/api/products?pushedPlatform=${platform}&perPage=200`, null, token, base)
  if (!res.ok) throw new Error(`Failed to fetch queued products: ${res.status}`)
  const json = await res.json() as { data: Array<{ id: string }> }
  return json.data?.map((p) => p.id) ?? []
}

async function getProductDetail(sku: string, token: string, base: string): Promise<ProductDetail> {
  const res = await apiFetch('GET', `/api/products/${sku}`, null, token, base)
  if (!res.ok) throw new Error(`Failed to fetch product ${sku}: ${res.status}`)
  const json = await res.json() as { data: ProductDetail }
  return json.data
}

async function getChannelProducts(platform: 'libre_market' | 'xmr_bazaar', token: string, base: string): Promise<ChannelProductSummary[]> {
  const all: ChannelProductSummary[] = []
  const perPage = 200
  let page = 1
  while (true) {
    const res = await apiFetch('GET', `/api/channels/${platform}?page=${page}&perPage=${perPage}`, null, token, base)
    if (!res.ok) throw new Error(`Failed to fetch channel products for ${platform}: ${res.status}`)
    const json = await res.json() as { products?: ChannelProductSummary[] }
    const batch = json.products ?? []
    all.push(...batch)
    if (batch.length < perPage) break
    page++
  }
  return all
}

async function markDone(
  sku: string, platform: 'libre_market' | 'xmr_bazaar',
  platformId: string, isNew: boolean, token: string, base: string
): Promise<void> {
  if (isNew && platformId) {
    const res = await apiFetch('POST', '/api/mappings', {
      productId: sku, platform, platformId, recordType: 'product',
    }, token, base)
    if (res.ok) console.log(`  âœ… Saved mapping ${sku} â†’ ${platformId}`)
    else console.log(`  âš ï¸  Failed to save mapping for ${sku}: ${res.status}`)
  }
  const res = await apiFetch('PATCH', `/api/products/${sku}/push-status`, {
    platform, status: 'done',
  }, token, base)
  if (res.ok) console.log(`  âœ… ${sku}: pushed_${platform} = done`)
  else console.log(`  âš ï¸  Failed to mark ${sku} done: ${res.status}`)
}

async function upsertMappingOnly(
  sku: string,
  platform: 'libre_market' | 'xmr_bazaar',
  platformId: string,
  token: string,
  base: string
): Promise<void> {
  const res = await apiFetch('POST', '/api/mappings', {
    productId: sku,
    platform,
    platformId,
    recordType: 'product',
  }, token, base)
  if (res.ok) console.log(`  âœ… Updated mapping ${sku} â†’ ${platformId}`)
  else console.log(`  âš ï¸  Failed to update mapping for ${sku}: ${res.status}`)
}

async function postRunReport(report: BrowserRunReport, token: string, base: string): Promise<void> {
  const summary = [
    `queued=${report.queued}`,
    `processed=${report.processed}`,
    `created=${report.created}`,
    `updated=${report.updated}`,
    `failed=${report.failed}`,
    report.dryRun ? 'dryRun=1' : 'dryRun=0',
    ...(report.errors.length > 0 ? [`errors=${report.errors.join(' | ')}`] : []),
  ].join(' ; ')

  await apiFetch('POST', '/api/sync/logs', {
    platform: report.platform,
    action: 'browser_push_run',
    status: report.failed > 0 ? 'error' : 'success',
    message: summary.slice(0, 4900),
    triggeredBy: 'agent',
  }, token, base).catch(() => {})
}

async function postProductProgress(
  productId: string,
  platform: 'libre_market' | 'xmr_bazaar',
  status: 'success' | 'error',
  message: string,
  token: string,
  base: string
): Promise<void> {
  await apiFetch('POST', '/api/sync/logs', {
    productId,
    platform,
    action: 'push_product',
    status,
    message: message.slice(0, 4900),
    triggeredBy: 'agent',
  }, token, base).catch(() => {})
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

async function downloadToTemp(url: string, sku: string, i: number): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf  = Buffer.from(await res.arrayBuffer())
    const dest = path.join(os.tmpdir(), `wizhard-${sku}-${i}.jpg`)
    fs.writeFileSync(dest, buf)
    return dest
  } catch { return null }
}

async function imgDims(page: Page, p: string): Promise<{ w: number; h: number }> {
  const b64 = fs.readFileSync(p).toString('base64')
  return page.evaluate(async (src: string) => {
    return new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ w: 0, h: 0 })
      img.src = src
    })
  }, `data:image/jpeg;base64,${b64}`).catch(() => ({ w: 0, h: 0 }))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function getTotalStock(product: ProductDetail): number {
  const stockData = (product as unknown as { stock?: Record<string, number | null> }).stock
  if (!stockData) return 0
  return (stockData.ireland ?? 0) + (stockData.acer_store ?? 0) + (stockData.poland ?? 0)
}

function normalizeLmPlatformId(idOrUrl: string): string {
  if (/^https?:\/\//.test(idOrUrl)) {
    const m = idOrUrl.match(/\/products\/([^/?#]+)/)
    if (m?.[1]) return m[1]
  }
  return idOrUrl.replace(/\/+$/, '')
}

function getSummaryTotalStock(row: ChannelProductSummary): number {
  return (row.stock.ireland ?? 0) + (row.stock.acer_store ?? 0) + (row.stock.poland ?? 0)
}

// ---------------------------------------------------------------------------
// Libre Market automation
// ---------------------------------------------------------------------------

async function lmLogin(page: Page, email: string, password: string): Promise<void> {
  console.log('  ðŸ” Logging in to Libre Market...')
  await page.goto('https://libre-market.com/m/coincart/admin/')
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/admin/')) { console.log('  Already authenticated'); return }
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  if (page.url().includes('/login')) throw new Error('Libre Market login failed â€” check credentials')
}

async function lmLogout(page: Page): Promise<void> {
  // Libre Market logout is UI-driven; try the provided XPath first.
  const xpathBtn = page.locator('xpath=/html/body/div[5]/button/span').first()
  if (await xpathBtn.count() > 0) {
    await xpathBtn.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(700)
    return
  }

  // Fallbacks when modal/index differs.
  const link = page.locator('a[href*="logout"], a:has-text("Deconnexion"), a:has-text("Logout")').first()
  if (await link.count() > 0) {
    await link.click({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(700)
    return
  }

  // Last-resort legacy endpoint (no-op on current site if missing).
  await page.goto('https://libre-market.com/api/auth/signout', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {})
}

async function lmSuivant(page: Page, label: string): Promise<void> {
  const btn = page.locator('button:has-text("Suivant")').last()
  await btn.waitFor({ state: 'visible', timeout: 5000 })

  const deadline = Date.now() + 5000
  let enabled = false
  while (Date.now() < deadline) {
    const disabled = await btn.isDisabled().catch(() => true)
    if (!disabled) {
      enabled = true
      break
    }
    await page.waitForTimeout(200)
  }
  if (!enabled) {
    throw new Error(`LM_STEP_BLOCKED_FIELD_MISSING: Suivant not clickable after 5s (${label})`)
  }

  await btn.click()
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(400)
  console.log(`    Suivant â†’ ${label}`)
}

async function lmSetCreateStockOne(page: Page): Promise<void> {
  const candidates = [
    { name: 'stock-div3', locator: page.locator('xpath=/html/body/div[3]/div/main/div/div[3]/div[1]/div[6]/div[1]/input').first() },
    { name: 'stock-div2', locator: page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[6]/div[1]/input').first() },
    { name: 'stock-label', locator: page.getByLabel(/Stock actuel/i).first() },
    { name: 'stock-text', locator: page.locator('xpath=//*[contains(normalize-space(.),"Stock actuel")]/following::input[1]').first() },
  ]

  let stock = candidates[0].locator
  let selected = candidates[0].name
  let found = false
  for (const c of candidates) {
    const visible = await c.locator.isVisible().catch(() => false)
    if (visible) {
      stock = c.locator
      selected = c.name
      found = true
      break
    }
  }
  if (!found) {
    for (const c of candidates) {
      const visible = await c.locator.isVisible().catch(() => false)
      const count = await c.locator.count().catch(() => 0)
      console.log(`    stock candidate ${c.name}: visible=${visible} count=${count}`)
    }
    throw new Error('LM_STOCK_FIELD_NOT_FOUND')
  }

  console.log(`    stock selector: ${selected}`)
  await stock.click({ clickCount: 3 }).catch(() => {})
  await page.keyboard.press('Control+A').catch(() => {})
  await page.keyboard.type('1', { delay: 25 }).catch(() => {})
  await page.keyboard.press('Tab').catch(() => {})
  await page.waitForTimeout(150)
}

async function lmWaitImageSettled(page: Page): Promise<void> {
  // Give the uploader enough time to finish and UI to re-enable navigation.
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2500)
}

const LM_SIZE_ERROR_PATTERNS = [
  /taille.*(max|maximum|limite)/i,
  /trop.*(grand|grande)/i,
  /fichier.*(grand|lourd|poids)/i,
  /size.*(limit|max|too large)/i,
  /exceed(ed)?/i,
]

async function lmWarnIfImageRejected(page: Page, context: string, input?: ReturnType<Page['locator']>) {
  let filesCount = -1
  if (input) {
    filesCount = await input.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0).catch(() => -1)
  }

  const selectors = [
    '[role="alert"]',
    '.alert',
    '.error',
    '.text-danger',
    '.text-red-500',
    '.form-error',
    '.invalid-feedback',
  ]
  const messages: string[] = []
  for (const sel of selectors) {
    const nodes = await page.locator(sel).all().catch(() => [])
    for (const node of nodes) {
      const txt = (await node.textContent().catch(() => ''))?.trim()
      if (txt) messages.push(txt)
    }
  }

  const bodyText = (await page.textContent('body').catch(() => '')) ?? ''
  const candidates = [...messages, bodyText]
  const matched = candidates.find((txt) => LM_SIZE_ERROR_PATTERNS.some((re) => re.test(txt)))

  if (filesCount === 0 || matched) {
    console.log(`    Warning: Libre Market rejected image upload (${context})${matched ? ` — ${matched.slice(0, 120)}` : ''}`)
  }
}

async function lmRankImagesByQuality(page: Page, imagePaths: string[]): Promise<string[]> {
  const scored: Array<{ path: string; area: number; bytes: number }> = []
  for (const p of imagePaths) {
    const dims = await imgDims(page, p)
    const area = Math.max(0, dims.w) * Math.max(0, dims.h)
    const bytes = fs.statSync(p).size
    scored.push({ path: p, area, bytes })
  }
  scored.sort((a, b) => (b.area - a.area) || (b.bytes - a.bytes))
  return scored.map((s) => s.path)
}

async function xmrIsListingNotFound(page: Page): Promise<boolean> {
  const candidates = [
    'xpath=/html/body/div[3]/div/div[2]/h2',
    'xpath=/html/body/div[2]/div/div[2]/h2',
    'h1, h2, .alert, .notice',
  ]

  for (const sel of candidates) {
    const txt = (await page.locator(sel).first().textContent().catch(() => ''))?.trim().toLowerCase() ?? ''
    if (txt.includes('listing not found')) return true
  }

  const body = (await page.textContent('body').catch(() => ''))?.toLowerCase() ?? ''
  return body.includes('listing not found')
}

async function lmSetCreatePrice(page: Page, value: number): Promise<void> {
  const desired = String(value)
  const candidates = [
    'xpath=/html/body/div[3]/div/main/div/div[3]/div[1]/div[3]/div/input',
    'xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[3]/div/input',
  ]

  for (const sel of candidates) {
    const input = page.locator(sel).first()
    if (await input.count() === 0) continue
    await input.click().catch(() => {})
    await input.fill(desired).catch(() => {})
    await page.waitForTimeout(120)
    const actual = await input.inputValue().catch(() => '')
    if (actual.trim() !== '') return
  }

  // Generic fallback: first numeric field on characteristics page is usually price.
  const generic = page.locator('input[type="number"], input[inputmode="decimal"]').first()
  if (await generic.count() > 0) {
    await generic.click().catch(() => {})
    await generic.fill(desired).catch(() => {})
    await page.waitForTimeout(120)
    const actual = await generic.inputValue().catch(() => '')
    if (actual.trim() !== '') return
  }

  throw new Error(`LM_CREATE_PRICE_SET_FAILED: unable to set price (${desired})`)
}

async function lmClickPublierWithFallback(page: Page): Promise<void> {
  const publishBtn = page.locator('button:has-text("Publier"), button:has-text("CrÃ©er")').first()
  if (await publishBtn.count() > 0) {
    await publishBtn.click().catch(() => {})
    await page.waitForTimeout(700)
  }

  // If the form did not advance to publish step, click "Suivant" once and retry.
  if (await page.locator('button:has-text("Suivant")').count() > 0) {
    await lmSuivant(page, 'publish fallback')
    const publishBtn2 = page.locator('button:has-text("Publier"), button:has-text("CrÃ©er")').first()
    if (await publishBtn2.count() > 0) {
      await publishBtn2.click()
    }
  }
}

async function lmCreate(page: Page, product: ProductDetail, imagePaths: string[]): Promise<string> {
  const price = product.prices.libre_market?.price
  if (!price) throw new Error('No libre_market price set')
  const desc = stripHtml(product.description ?? product.title)

  await page.goto('https://libre-market.com/m/coincart/admin/products/new')
  await page.waitForLoadState('load')

  // Step 1 â€” type + basic info
  const nonAlim = page.locator('button:has-text("Non-alimentaire")').first()
  if (await nonAlim.count() > 0) await nonAlim.click()
  else await page.locator('.btn-group button, [class*="type"] button').nth(1).click().catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[5]/input').fill(product.title)
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[6]/textarea').fill(desc)
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[7]/div[1]/input')
    .fill('Informatique').catch(() => {})
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[8]/input')
    .fill(product.id).catch(() => {})
  await lmSuivant(page, 'step 1')

  // Step 2 â€” characteristics
  await lmSetCreatePrice(page, price)
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[8]/div/input').fill('500')
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[10]/div[2]/label[2]/span')
    .click().catch(() => {})
  await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[11]/div/input').fill('5')
  // Temporary test mode requested by user: set stock last and force value=1.
  await lmSetCreateStockOne(page)
  await lmSuivant(page, 'step 2')

  // Step 3 - photos
  // Prefer >=800x800, but if none match keep going with the largest available image.
  let chosenPath: string | null = null
  let fallback: { path: string; area: number } | null = null
  for (const imgPath of imagePaths) {
    const dims = await imgDims(page, imgPath)
    const area = Math.max(0, dims.w) * Math.max(0, dims.h)
    if (!fallback || area > fallback.area) fallback = { path: imgPath, area }
    if (dims.w >= 800 && dims.h >= 800) {
      chosenPath = imgPath
      break
    }
  }
  if (!chosenPath && fallback) {
    chosenPath = fallback.path
    console.log('    Warning: no image >=800x800, using best available fallback image')
  }
  if (chosenPath) {
    const fileInput = page.locator('input[type="file"]').first()
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(chosenPath)
    } else {
      await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[2]/div[1]/div')
        .first().click().catch(() => {})
    }
    await lmWaitImageSettled(page)
  }
  await lmSuivant(page, 'step 3')
  await lmSuivant(page, 'step 4')

  // Step 5 â€” visibility (Brouillon)
  await page.locator('input[value="draft"], input[value="brouillon"], label:has-text("Brouillon") input').first()
    .click().catch(async () => {
      await page.locator('label:has-text("Brouillon")').first().click().catch(() => {})
    })
  await lmClickPublierWithFallback(page)
  await page.waitForURL((url) => !url.href.includes('/products/new'), { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('load')

  // Extract product ID from URL
  const directMatch = page.url().match(/\/products\/([^/?#/]+)/)
  if (directMatch && directMatch[1] !== 'new') return directMatch[1]

  // Redirected to list â€” click matching row
  await page.waitForTimeout(800)
  const row = page.locator('tr, [role="row"], [class*="product"], [class*="item"]')
    .filter({ hasText: product.title.slice(0, 20) }).first()
  if (await row.count() > 0) {
    await row.click()
    await page.waitForURL((url) => /\/products\/[^/]+$/.test(url.pathname), { timeout: 10000 }).catch(() => {})
    const m = page.url().match(/\/products\/([^/?#/]+)$/)
    if (m) return m[1]
  }
  throw new Error('Could not extract Libre Market product ID after creation')
}

async function lmEdit(page: Page, platformId: string, product: ProductDetail, status: 'active' | 'archived' = 'active'): Promise<void> {
  const price = product.prices.libre_market?.price
  const stock = getTotalStock(product)
  const listingId = normalizeLmPlatformId(platformId)
  await page.goto(`https://libre-market.com/m/coincart/admin/products/${listingId}/edit`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)
  const missingMsg = page.locator('xpath=/html/body/div[2]/div/main/div/div/p').first()
  if (await missingMsg.count() > 0) {
    const txt = (await missingMsg.textContent().catch(() => ''))?.trim().toLowerCase() ?? ''
    if (txt.includes('produit non trouv')) {
      throw new Error('LM_LISTING_NOT_FOUND')
    }
  }
  await page.locator('xpath=/html/body/div[2]/div/main/div/form/div[3]/div/div[1]/input')
    .first()
    .fill(String(price ?? ''))
    .catch(async () => {
      if (price != null) {
        await page.locator('xpath=/html/body/div[2]/div/main/div/div[3]/div[1]/div[3]/div/input')
          .fill(String(price))
          .catch(() => {})
      }
    })
  const statusSelect = page.locator('xpath=/html/body/div[2]/div/main/div/form/div[2]/div/div[4]/div[2]/select').first()
  if (await statusSelect.count() > 0) {
    if (status === 'active') {
      await statusSelect.selectOption({ label: 'Publié' }).catch(async () => {
        await statusSelect.selectOption({ label: 'Actif' }).catch(async () => {
          await statusSelect.selectOption({ value: 'active' }).catch(async () => {
            await statusSelect.selectOption({ value: 'published' }).catch(() => {})
          })
        })
      })
    } else {
      await statusSelect.selectOption({ label: 'Archivé' }).catch(async () => {
        await statusSelect.selectOption({ value: 'archived' }).catch(async () => {
          await statusSelect.selectOption({ value: 'draft' }).catch(() => {})
        })
      })
    }
  }
  // LibreMarket rejects stock=0 — skip stock field when archiving (out of stock)
  if (status === 'active' && stock > 0) {
    await page.locator('xpath=/html/body/div[2]/div/main/div/form/div[4]/div/div[1]/input')
      .first()
      .fill(String(stock))
      .catch(async () => {
        await page.locator('xpath=/html/body/div[3]/div/main/div/form/div[4]/div/div[1]/input')
          .first()
          .fill(String(stock))
          .catch(() => {})
      })
  }
  const saveBtn = page.locator('xpath=/html/body/div[2]/div/main/div/form/div[8]/button').first()
  if (await saveBtn.count() > 0) {
    await saveBtn.click().catch(() => {})
    await page.waitForLoadState('load').catch(() => {})
  } else {
    const fallback = page.locator(
      'button:has-text("Enregistrer"), button:has-text("Mettre Ã  jour"), button:has-text("Sauvegarder"), button[type="submit"]'
    ).first()
    if (await fallback.count() > 0) {
      await fallback.click().catch(() => {})
      await page.waitForLoadState('load').catch(() => {})
    }
  }
}

async function lmSetArchived(page: Page, platformId: string): Promise<void> {
  const listingId = normalizeLmPlatformId(platformId)
  await page.goto(`https://libre-market.com/m/coincart/admin/products/${listingId}/edit`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(500)

  const missingMsg = page.locator('xpath=/html/body/div[2]/div/main/div/div/p').first()
  if (await missingMsg.count() > 0) {
    const txt = (await missingMsg.textContent().catch(() => ''))?.trim().toLowerCase() ?? ''
    if (txt.includes('produit non trouv')) throw new Error('LM_LISTING_NOT_FOUND')
  }

  const statusSelect = page.locator('xpath=/html/body/div[2]/div/main/div/form/div[2]/div/div[4]/div[2]/select').first()
  if (await statusSelect.count() === 0) throw new Error(`LM_STATUS_SELECT_NOT_FOUND: ${platformId}`)
  await statusSelect.selectOption({ label: 'Archivé' }).catch(async () => {
    await statusSelect.selectOption({ value: 'archived' }).catch(async () => {
      await statusSelect.selectOption({ value: 'draft' }).catch(() => {})
    })
  })

  const saveBtn = page.locator('xpath=/html/body/div[2]/div/main/div/form/div[8]/button').first()
  if (await saveBtn.count() > 0) {
    await saveBtn.click().catch(() => {})
    await page.waitForLoadState('load').catch(() => {})
    return
  }
  const saveBtnAlt = page.locator('xpath=/html/body/div[3]/div/main/div/form/div[8]/button').first()
  if (await saveBtnAlt.count() > 0) {
    await saveBtnAlt.click().catch(() => {})
    await page.waitForLoadState('load').catch(() => {})
    return
  }
  const fallback = page.locator(
    'button:has-text("Enregistrer"), button:has-text("Mettre Ã  jour"), button:has-text("Sauvegarder"), button[type="submit"]'
  ).first()
  if (await fallback.count() > 0) {
    await fallback.click().catch(() => {})
    await page.waitForLoadState('load').catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// XMR Bazaar automation
// ---------------------------------------------------------------------------

async function xmrLogin(page: Page, username: string, password: string): Promise<void> {
  console.log('  ðŸ” Logging in to XMR Bazaar...')
  await page.goto('https://xmrbazaar.com/login/', { timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
  const rem = page.locator('input[name="remember_me"], label:has-text("Remember me") input').first()
  if (await rem.count() > 0) await rem.check().catch(() => {})
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  if (page.url().includes('/login')) throw new Error('XMR Bazaar login failed â€” check credentials')
}

async function xmrLogout(page: Page): Promise<void> {
  await page.goto('https://xmrbazaar.com/logout/')
  await page.waitForLoadState('load')
}

async function xmrClickXpath(page: Page, xpath: string, timeout = 8000): Promise<void> {
  const el = page.locator(`xpath=${xpath}`).first()
  await el.waitFor({ state: 'visible', timeout })
  await el.click()
}

async function xmrCheckXpath(page: Page, xpath: string): Promise<void> {
  await page.evaluate((xp) => {
    const node = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue as HTMLInputElement | HTMLElement | null
    if (!node) return
    if ((node as HTMLInputElement).checked === true) return
    ;(node as HTMLElement).click()
  }, xpath)
}

async function xmrFillForm(
  page: Page,
  product: ProductDetail,
  imagePaths: string[],
  moneroAddress: string,
  isEdit = false
): Promise<void> {
  const price = Math.floor(product.prices.xmr_bazaar?.price ?? 0)
  const desc  = stripHtml(product.description ?? product.title)

  await page.locator('select[name="category"]').selectOption({ label: 'Electronics' }).catch(() => {})
  await page.locator('input[name="title"]').fill(product.title)
  await page.locator('input[name="price"]').fill(String(price))
  await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[3]/div[2]/select')
    .first()
    .selectOption({ label: 'EUR (€)' })
    .catch(async () => {
      await page.locator('select[name="currency"]').selectOption({ label: 'EUR (€)' }).catch(async () => {
        await page.locator('select[name="currency"]').selectOption({ value: 'eur' }).catch(() => {})
      })
    })
  await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[5]/textarea')
    .first()
    .fill(desc)
    .catch(async () => {
      await page.locator('textarea[name="description"]').fill(desc).catch(() => {})
    })
  await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[6]/input')
    .first()
    .fill('electronics')
    .catch(async () => {
      await page.locator('input[name="tags"]').fill('electronics').catch(() => {})
    })

  if (!isEdit && imagePaths.length > 0) {
    const fileInputs = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[2]/div[1]/div/div/div/input')
    await fileInputs.first().setInputFiles(imagePaths[0]).catch(async () => {
      await page.locator('input[type="file"]').first().setInputFiles(imagePaths[0])
    })
    await page.waitForTimeout(1000)

    // Preferred slot/input for second picture (user-provided XPath).
    const secondPhotoInput = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[2]/div[2]/div/div/div[1]/div[1]/input').first()
    if (imagePaths[1] && await secondPhotoInput.count() > 0) {
      await secondPhotoInput.setInputFiles(imagePaths[1]).catch(() => {})
      await page.waitForTimeout(800)
    }

    // Preferred slot/input for third picture (user-provided XPath).
    const thirdPhotoInput = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[2]/div[2]/div/div/div[2]/div[1]/input').first()
    if (imagePaths[2] && await thirdPhotoInput.count() > 0) {
      await thirdPhotoInput.setInputFiles(imagePaths[2]).catch(() => {})
      await page.waitForTimeout(800)
    }

    const addPhotoBtn = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[2]/div[2]/div/div/div[1]/div[2]/label').first()
    for (let i = 3; i < Math.min(imagePaths.length, 4); i++) {
      await addPhotoBtn.click().catch(() => {})
      await page.waitForTimeout(500)
      const inputs = await fileInputs.all()
      if (inputs[i]) {
        await inputs[i].setInputFiles(imagePaths[i]).catch(async () => {
          const genericInputs = await page.locator('input[type="file"]').all()
          if (genericInputs[i]) await genericInputs[i].setInputFiles(imagePaths[i])
        })
        await page.waitForTimeout(800)
      }
    }
  }

  // Delivery: Physical
  await xmrClickXpath(page, '/html/body/div[3]/div/div[2]/form/div[3]/div[2]/div[1]/label/span[2]').catch(() => {
    throw new Error('Failed to select Physical delivery option')
  })
  await page.waitForTimeout(500)

  // Country
  const country = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[3]/div[3]/div[3]/select').first()
  if (await country.count() > 0) {
    await country.selectOption({ label: 'Poland' }).catch(async () => {
      await country.selectOption({ value: 'Poland' }).catch(() => {})
    })
  }

  // International shipping + cost
  await xmrCheckXpath(page, '/html/body/div[3]/div/div[2]/form/div[3]/div[4]/div[3]/div[1]/label').catch(() => {})
  await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[3]/div[4]/div[3]/div[2]/input').first().fill('10').catch(() => {})

  // Payments: direct + escrow
  await xmrClickXpath(page, '/html/body/div[3]/div/div[2]/form/div[4]/div[2]/div[1]/label/span[2]').catch(() => {})
  await xmrCheckXpath(page, '/html/body/div[3]/div/div[2]/form/div[4]/div[2]/div[2]/label/span[2]').catch(() => {})
  await page.waitForTimeout(500)

  // Monero address (becomes available after payment options are selected)
  await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[4]/div[3]/input')
    .first()
    .fill(moneroAddress)
    .catch(async () => {
      await page.locator('input[name*="monero"], input[id*="monero"]').first().fill(moneroAddress).catch(() => {})
    })

  // Unlimited stock + authorization
  await xmrCheckXpath(page, '/html/body/div[3]/div/div[2]/form/div[5]/div[1]/div[2]/label').catch(() => {})
  await xmrCheckXpath(page, '/html/body/div[3]/div/div[2]/form/div[6]/div/label').catch(() => {})
}

async function xmrCreate(
  page: Page,
  product: ProductDetail,
  imagePaths: string[],
  moneroAddress: string,
  delayState?: { submittedOnce: boolean }
): Promise<string> {
  await page.goto('https://xmrbazaar.com/new-listing/selling/sell-product/')
  await page.waitForLoadState('load')
  await xmrFillForm(page, product, imagePaths, moneroAddress)
  if (delayState) await xmrBeforeSubmit(delayState, page)
  await page.locator('button:has-text("Publish"), button:has-text("Update Listing"), button:has-text("Save"), input[type="submit"]')
    .first()
    .click()
  if (delayState) delayState.submittedOnce = true
  await page.waitForLoadState('load')
  await page.waitForTimeout(1200)

  // Prefer extracting from current URL after publish redirect.
  const fromUrl = page.url().match(/\/listing\/([A-Za-z0-9]+)\//)
  if (fromUrl?.[1]) return fromUrl[1]

  const href = await page.locator('a[href*="/listing/"]').first().getAttribute('href') ?? ''
  const m = href.match(/\/listing\/([A-Za-z0-9]+)\//)
  const listingId = m ? m[1] : ''
  if (!listingId) throw new Error('Could not extract XMR Bazaar listing ID')
  return listingId
}

async function xmrEdit(
  page: Page,
  platformId: string,
  product: ProductDetail,
  status: 'active' | 'out_of_stock',
  delayState?: { submittedOnce: boolean }
): Promise<void> {
  const price = product.prices.xmr_bazaar?.price ?? null
  const listingId = String(platformId)
    .replace(/^https?:\/\/xmrbazaar\.com\/listing\//, '')
    .replace(/^https?:\/\/xmrbazaar\.com\/edit-listing\//, '')
    .replace(/\/.*$/, '')
  const editUrl = `https://xmrbazaar.com/edit-listing/${listingId}/`

  // Preferred path: open edit page directly.
  await page.goto(editUrl)
  await page.waitForLoadState('load')
  if (await xmrIsListingNotFound(page)) throw new Error('XMR_LISTING_NOT_FOUND')

  // Fallback for unexpected routing/session behavior.
  const statusSelectCheck = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[1]/select').first()
  if (await statusSelectCheck.count() === 0) {
    const listingUrl = /^https?:\/\//.test(platformId)
      ? String(platformId).replace('/edit-listing/', '/listing/')
      : `https://xmrbazaar.com/listing/${listingId}/`

    await page.goto(listingUrl)
    await page.waitForLoadState('load')
    if (await xmrIsListingNotFound(page)) throw new Error('XMR_LISTING_NOT_FOUND')

    const editLink = page.locator('a[href*="/edit"], a:has-text("Edit")').first()
    if (await editLink.count() === 0) {
      if (await xmrIsListingNotFound(page)) throw new Error('XMR_LISTING_NOT_FOUND')
      throw new Error(`No Edit button found for listing ${platformId}`)
    }
    await editLink.click()
    await page.waitForLoadState('load')
  }

  const statusSelect = page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[1]/select').first()
  if (await statusSelect.count() > 0) {
    if (status === 'active') {
      await statusSelect.selectOption({ label: 'Active' }).catch(async () => {
        await statusSelect.selectOption({ value: 'active' }).catch(async () => {
          await statusSelect.selectOption({ value: '1' }).catch(() => {})
        })
      })
    } else {
      await statusSelect.selectOption({ label: 'Out of Stock' }).catch(async () => {
        await statusSelect.selectOption({ value: 'out_of_stock' }).catch(async () => {
          await statusSelect.selectOption({ value: 'out-of-stock' }).catch(async () => {
            await statusSelect.selectOption({ value: '0' }).catch(() => {})
          })
        })
      })
    }
  }

  if (status === 'active' && price != null) {
    await page.locator('xpath=/html/body/div[3]/div/div[2]/form/div[1]/div[4]/div[1]/input')
      .first()
      .fill(String(Math.floor(price)))
      .catch(async () => {
        await page.locator('input[name="price"]').first().fill(String(Math.floor(price))).catch(() => {})
      })
  }

  await xmrCheckXpath(page, '/html/body/div[3]/div/div[2]/form/div[6]/div/label/input').catch(() => {})
  if (delayState) await xmrBeforeSubmit(delayState, page)
  await page.locator('button:has-text("Update Listing"), button:has-text("Save"), input[type="submit"]')
    .first()
    .click()
  if (delayState) delayState.submittedOnce = true
  await page.waitForLoadState('load')
}

async function xmrBeforeSubmit(delayState: { submittedOnce: boolean }, page: Page): Promise<void> {
  if (!delayState.submittedOnce) return
  console.log('    Waiting 25s before XMR submit (rate-limit requirement)...')
  await page.waitForTimeout(25000)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function processPlatform(
  platform: 'libre_market' | 'xmr_bazaar',
  vars: Record<string, string>,
  token: string,
  apiBase: string
): Promise<BrowserRunReport> {
  console.log(`\n${'='.repeat(50)}\n${platform.toUpperCase()}\n${'='.repeat(50)}`)

  const skus = await getQueuedSkus(platform, token, apiBase)
  if (skus.length === 0) {
    console.log('  Nothing queued.')
    return { platform, queued: 0, processed: 0, created: 0, updated: 0, failed: 0, errors: [], dryRun: IS_DRY_RUN }
  }
  console.log(`  ${skus.length} product(s) queued: ${skus.join(', ')}`)
  if (IS_DRY_RUN) {
    console.log('  [dry-run] Skipping.')
    return { platform, queued: skus.length, processed: 0, created: 0, updated: 0, failed: 0, errors: [], dryRun: true }
  }

  // Fetch full product data for all queued SKUs
  const products: ProductDetail[] = []
  for (const sku of skus) {
    try {
      const p = await getProductDetail(sku, token, apiBase)
      if (!p.prices[platform]?.price) {
        console.log(`  âš ï¸  Skipping ${sku}: no price set for ${platform}`)
        continue
      }
      products.push(p)
    } catch (err) {
      console.log(`  âš ï¸  Skipping ${sku}: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (products.length === 0) {
    console.log('  No eligible products after checks.')
    return { platform, queued: skus.length, processed: 0, created: 0, updated: 0, failed: 0, errors: [], dryRun: false }
  }

  const report: BrowserRunReport = {
    platform,
    queued: skus.length,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    dryRun: false,
  }

  const browser = await chromium.launch({ headless: IS_HEADLESS, slowMo: IS_HEADLESS ? 0 : 100 })
  const page    = await browser.newPage()
  page.setDefaultTimeout(60000)

  try {
    // Login once
    if (platform === 'libre_market') {
      const email    = vars['LIBRE_MARKET_EMAIL']
      const password = vars['LIBRE_MARKET_PASSWORD']
      if (!email || !password) throw new Error('LIBRE_MARKET_EMAIL or LIBRE_MARKET_PASSWORD not set in .dev.vars')
      await lmLogin(page, email, password)
    } else {
      const username = vars['XMR_BAZAAR_USERNAME']
      const password = vars['XMR_BAZAAR_PASSWORD']
      const moneroAddress = vars['XMR_BAZAAR_MONERO_ADDRESS']
      if (!username || !password) throw new Error('XMR_BAZAAR_USERNAME or XMR_BAZAAR_PASSWORD not set in .dev.vars')
      if (!moneroAddress) throw new Error('XMR_BAZAAR_MONERO_ADDRESS not set in .dev.vars')
      await xmrLogin(page, username, password)
    }

    const openedPlatformIds = new Set<string>()
    const xmrSubmitState = { submittedOnce: false }

    // Process each product
    for (let idx = 0; idx < products.length; idx++) {
      const product = products[idx]
      console.log(`\n  â†’ ${product.id}: ${product.title.slice(0, 50)}`)

      // Download images to temp files
      const sorted     = [...product.images].sort((a, b) => a.position - b.position)
      const imagePaths: string[] = []
      for (let i = 0; i < Math.min(sorted.length, 4); i++) {
        const p = await downloadToTemp(sorted[i].url, product.id, i)
        if (p) imagePaths.push(p)
      }
      console.log(`    ${imagePaths.length} image(s) downloaded`)

      const mapping = product.platforms[platform]
      const isNew   = !mapping?.platformId
      const desiredXmrStatus = getTotalStock(product) > 0 ? 'active' : 'out_of_stock'
      const desiredLmStatus = getTotalStock(product) > 0 ? 'active' : 'archived'

      try {
        let platformId: string
        let createdOrRemapped = false
        if (isNew) {
          console.log('    Creating new listing...')
          platformId = platform === 'libre_market'
            ? await lmCreate(page, product, imagePaths)
            : await xmrCreate(page, product, imagePaths, vars['XMR_BAZAAR_MONERO_ADDRESS']!, xmrSubmitState)
          if (platform === 'libre_market' && getTotalStock(product) === 0) {
            await lmEdit(page, platformId, product, 'archived')
          }
          console.log(`    âœ… Created â†’ ${platformId}`)
          openedPlatformIds.add(platformId)
          createdOrRemapped = true
          report.created++
        } else {
          platformId = mapping!.platformId
          console.log(`    Editing existing listing ${platformId}...`)
          try {
            if (platform === 'libre_market') await lmEdit(page, platformId, product, desiredLmStatus)
            else await xmrEdit(page, platformId, product, desiredXmrStatus, xmrSubmitState)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const missingMappedListing = msg.includes('LM_LISTING_NOT_FOUND') || msg.includes('XMR_LISTING_NOT_FOUND')
            if (!missingMappedListing) throw err
            console.log('    Mapped listing not found remotely â€” recreating from scratch...')
            platformId = platform === 'libre_market'
              ? await lmCreate(page, product, imagePaths)
              : await xmrCreate(page, product, imagePaths, vars['XMR_BAZAAR_MONERO_ADDRESS']!, xmrSubmitState)
            if (platform === 'libre_market' && getTotalStock(product) === 0) {
              await lmEdit(page, platformId, product, 'archived')
            }
            if (platform === 'xmr_bazaar' && getTotalStock(product) === 0) {
              await xmrEdit(page, platformId, product, 'out_of_stock', xmrSubmitState)
            }
            console.log(`    âœ… Recreated â†’ ${platformId}`)
            createdOrRemapped = true
            openedPlatformIds.add(platformId)
            report.created++
          }
          console.log(`    âœ… Updated`)
          openedPlatformIds.add(platformId)
          if (!createdOrRemapped) report.updated++
        }
        await markDone(product.id, platform, platformId, isNew || createdOrRemapped, token, apiBase)
        report.processed++
        await postProductProgress(
          product.id,
          platform,
          'success',
          createdOrRemapped ? `created ${platformId}` : `updated ${platformId}`,
          token,
          apiBase
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`    âŒ Failed: ${msg}`)
        report.failed++
        report.errors.push(`${product.id}: ${msg}`)
        report.processed++
        await postProductProgress(product.id, platform, 'error', msg, token, apiBase)
        await page.screenshot({
          path: path.join(process.cwd(), 'scripts', `error-${platform}-${product.id}.png`),
          fullPage: true,
        })
      }

      // Cleanup temp images
      for (const p of imagePaths) fs.unlink(p, () => {})
    }

    if (platform === 'xmr_bazaar') {
      console.log('\n  Reconciling XMR Bazaar listings not touched in this push...')
      const allChannelProducts = await getChannelProducts('xmr_bazaar', token, apiBase)
      const normalizedOpened = new Set(
        Array.from(openedPlatformIds).map((id) => id.replace(/^https?:\/\/xmrbazaar\.com\/listing\//, '').replace(/\/.*$/, ''))
      )
      const staleListings = allChannelProducts
        .filter((p) => !!p.platformId)
        .filter((p) => getSummaryTotalStock(p) <= 0)
        .filter((p) => !normalizedOpened.has(String(p.platformId).replace(/^https?:\/\/xmrbazaar\.com\/listing\//, '').replace(/\/.*$/, '')))

      for (let i = 0; i < staleListings.length; i++) {
        const row = staleListings[i]
        const platformId = row.platformId!
        console.log(`  â†’ ${row.sku}: set Out of Stock (${platformId})`)
        try {
          const synthetic = {
            id: row.sku,
            title: row.sku,
            description: null,
            images: [],
            prices: { xmr_bazaar: { price: 0, compareAt: null } },
            platforms: {},
          } as ProductDetail
          await xmrEdit(page, platformId, synthetic, 'out_of_stock', xmrSubmitState)
          console.log('    âœ… Out of Stock saved')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('XMR_LISTING_NOT_FOUND')) {
            console.log('    Mapped listing missing â€” recreating then forcing Out of Stock...')
            try {
              const detail = await getProductDetail(row.sku, token, apiBase)
              const sorted = [...detail.images].sort((a, b) => a.position - b.position)
              const imagePaths: string[] = []
              for (let j = 0; j < Math.min(sorted.length, 4); j++) {
                const p = await downloadToTemp(sorted[j].url, detail.id, j)
                if (p) imagePaths.push(p)
              }

              const newId = await xmrCreate(page, detail, imagePaths, vars['XMR_BAZAAR_MONERO_ADDRESS']!, xmrSubmitState)
              await xmrEdit(page, newId, detail, 'out_of_stock', xmrSubmitState)

              await upsertMappingOnly(detail.id, 'xmr_bazaar', newId, token, apiBase)
              for (const p of imagePaths) fs.unlink(p, () => {})
              console.log(`    âœ… Recreated and set Out of Stock (${newId})`)
            } catch (inner) {
              const innerMsg = inner instanceof Error ? inner.message : String(inner)
              console.log(`    âš ï¸  Failed to recreate+out-of-stock: ${innerMsg}`)
            }
          } else {
            console.log(`    âš ï¸  Failed to set Out of Stock: ${msg}`)
          }
        }
      }
    } else if (platform === 'libre_market') {
      console.log('\n  Reconciling Libre Market listings not touched in this push...')
      const allChannelProducts = await getChannelProducts('libre_market', token, apiBase)
      const normalizedOpened = new Set(
        Array.from(openedPlatformIds).map((id) => normalizeLmPlatformId(id))
      )
      const staleListings = allChannelProducts
        .filter((p) => !!p.platformId)
        .filter((p) => getSummaryTotalStock(p) <= 0)
        .filter((p) => !normalizedOpened.has(normalizeLmPlatformId(String(p.platformId))))

      for (const row of staleListings) {
        const mappedId = row.platformId!
        console.log(`  â†’ ${row.sku}: set Archivé (${mappedId})`)
        try {
          await lmSetArchived(page, mappedId)
          console.log('    âœ… Archivé saved')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('LM_LISTING_NOT_FOUND')) {
            console.log('    Mapped listing missing â€” recreating then forcing Archivé...')
            try {
              const detail = await getProductDetail(row.sku, token, apiBase)
              const sorted = [...detail.images].sort((a, b) => a.position - b.position)
              const imagePaths: string[] = []
              for (let i = 0; i < Math.min(sorted.length, 4); i++) {
                const p = await downloadToTemp(sorted[i].url, detail.id, i)
                if (p) imagePaths.push(p)
              }
              const newId = await lmCreate(page, detail, imagePaths)
              await lmSetArchived(page, newId)
              await markDone(detail.id, 'libre_market', newId, true, token, apiBase)
              for (const p of imagePaths) fs.unlink(p, () => {})
              console.log(`    âœ… Recreated and archived (${newId})`)
            } catch (inner) {
              const innerMsg = inner instanceof Error ? inner.message : String(inner)
              console.log(`    âš ï¸  Failed to recreate+archive: ${innerMsg}`)
            }
          } else {
            console.log(`    âš ï¸  Failed to set Archivé: ${msg}`)
          }
        }
      }
    }

    // Logout
    if (platform === 'libre_market') await lmLogout(page)
    else await xmrLogout(page)
    console.log('\n  Logged out.')
    return report

  } finally {
    await page.waitForTimeout(2000)
    await browser.close()
  }
}

async function main() {
  const vars    = DEV_VARS
  const token   = vars['AGENT_BEARER_TOKEN']
  const apiBase = IS_LOCAL
    ? 'http://127.0.0.1:8787'
    : (vars['WIZHARD_URL'] ?? (() => { throw new Error('Set WIZHARD_URL in .dev.vars or use --local') })())

  if (!token) { console.error('âŒ AGENT_BEARER_TOKEN not set in .dev.vars'); process.exit(1) }

  console.log(`API: ${apiBase}${IS_DRY_RUN ? ' [dry-run]' : ''}`)

  const platforms: Array<'libre_market' | 'xmr_bazaar'> = ONLY_PLATFORM
    ? [ONLY_PLATFORM as 'libre_market' | 'xmr_bazaar']
    : ['libre_market', 'xmr_bazaar']

  const reports: BrowserRunReport[] = []
  for (const platform of platforms) {
    const report = await processPlatform(platform, vars, token, apiBase)
    reports.push(report)
    await postRunReport(report, token, apiBase)
  }

  console.log('\nâœ… All done.')
}

main().catch((err) => { console.error(err); process.exit(1) })



