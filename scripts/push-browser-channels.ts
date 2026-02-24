/**
 * push-browser-channels.ts — Push queued products to Libre Market and XMR Bazaar
 *
 * Queries Wizhard API for products with pushed status = '2push', automates
 * the browser to create or edit each listing, then marks them as done in D1.
 *
 * Usage:
 *   npx tsx scripts/push-browser-channels.ts              → prod API (WIZHARD_URL from .dev.vars)
 *   npx tsx scripts/push-browser-channels.ts --local      → http://127.0.0.1:8787
 *   npx tsx scripts/push-browser-channels.ts --dry-run    → list queued products, no browser
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
  const content = fs.readFileSync(path.join(process.cwd(), '.dev.vars'), 'utf-8')
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/)
    if (m) vars[m[1]] = m[2].trim()
  }
  return vars
}

const args          = process.argv.slice(2)
const IS_LOCAL      = args.includes('--local')
const IS_DRY_RUN    = args.includes('--dry-run')
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

async function apiFetch(method: string, apiPath: string, body: unknown, token: string, base: string): Promise<Response> {
  return fetch(`${base}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

async function markDone(
  sku: string, platform: 'libre_market' | 'xmr_bazaar',
  platformId: string, isNew: boolean, token: string, base: string
): Promise<void> {
  if (isNew && platformId) {
    const res = await apiFetch('POST', '/api/mappings', {
      productId: sku, platform, platformId, recordType: 'product',
    }, token, base)
    if (res.ok) console.log(`  ✅ Saved mapping ${sku} → ${platformId}`)
    else console.log(`  ⚠️  Failed to save mapping for ${sku}: ${res.status}`)
  }
  const res = await apiFetch('PATCH', `/api/products/${sku}/push-status`, {
    platform, status: 'done',
  }, token, base)
  if (res.ok) console.log(`  ✅ ${sku}: pushed_${platform} = done`)
  else console.log(`  ⚠️  Failed to mark ${sku} done: ${res.status}`)
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

// ---------------------------------------------------------------------------
// Libre Market automation
// ---------------------------------------------------------------------------

async function lmLogin(page: Page, email: string, password: string): Promise<void> {
  console.log('  🔐 Logging in to Libre Market...')
  await page.goto('https://libre-market.com/m/coincart/admin/')
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/admin/')) { console.log('  Already authenticated'); return }
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  if (page.url().includes('/login')) throw new Error('Libre Market login failed — check credentials')
}

async function lmLogout(page: Page): Promise<void> {
  const link = page.locator('a[href*="logout"], a:has-text("Déconnexion")').first()
  if (await link.count() > 0) { await link.click(); return }
  await page.goto('https://libre-market.com/api/auth/signout').catch(() => {})
  await page.locator('button:has-text("Sign out"), form button').first().click().catch(() => {})
}

async function lmSuivant(page: Page, label: string): Promise<void> {
  const btn = page.locator('button:has-text("Suivant")').last()
  await page.waitForTimeout(600)
  if (await btn.isDisabled()) await btn.click({ force: true })
  else await btn.click()
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
  console.log(`    Suivant → ${label}`)
}

async function lmCreate(page: Page, product: ProductDetail, imagePaths: string[]): Promise<string> {
  const price = product.prices.libre_market?.price
  if (!price) throw new Error('No libre_market price set')
  const desc = stripHtml(product.description ?? product.title)

  await page.goto('https://libre-market.com/m/coincart/admin/products/new')
  await page.waitForLoadState('load')

  // Step 1 — type + basic info
  const nonAlim = page.locator('button:has-text("Non-alimentaire")').first()
  if (await nonAlim.count() > 0) await nonAlim.click()
  else await page.locator('.btn-group button, [class*="type"] button').nth(1).click().catch(() => {})
  await page.waitForTimeout(400)
  await page.getByLabel('Nom du produit', { exact: false }).fill(product.title)
  await page.getByLabel('Description', { exact: false }).fill(desc)
  const catSel = page.getByLabel('Catégorie', { exact: false }).first()
  if (await catSel.count() > 0)
    await catSel.selectOption({ label: 'Informatique' }).catch(async () => {
      const opts = await catSel.locator('option').all()
      if (opts.length > 1) await catSel.selectOption({ index: 1 }).catch(() => {})
    })
  await lmSuivant(page, 'step 1')

  // Step 2 — characteristics
  await page.locator('input[placeholder="0.00"]').first().fill(String(price))
  await page.waitForTimeout(300)
  const precoInput = page.locator('label').filter({ hasText: /précommande/i }).first()
    .locator('input[type="checkbox"]')
  if (await precoInput.count() > 0 && !(await precoInput.isChecked())) await precoInput.check()
  await page.waitForTimeout(400)
  await page.getByLabel('Délai de fabrication', { exact: false }).first().fill('1').catch(async () => {
    await page.locator('input[placeholder="Ex: 7"]').first().fill('1')
  })
  await page.getByLabel('Poids du produit', { exact: false }).first().fill('500').catch(async () => {
    await page.locator('input[placeholder="Ex: 250"]').first().fill('500')
  })
  const nonRadio = page.getByRole('radio', { name: /^Non$/i }).first()
  if (await nonRadio.count() > 0) await nonRadio.click()
  await page.locator('input[placeholder="Ex: 15"]').first().fill('5').catch(() => {})
  await lmSuivant(page, 'step 2')

  // Step 3 — photos
  for (const imgPath of imagePaths) {
    const dims = await imgDims(page, imgPath)
    if (dims.w >= 800 && dims.h >= 800) {
      const fileInput = page.locator('input[type="file"]').first()
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(imgPath)
        await page.waitForTimeout(1500)
        break
      }
    }
  }
  await lmSuivant(page, 'step 3')
  await lmSuivant(page, 'step 4')

  // Step 5 — visibility (Brouillon)
  await page.locator('input[value="draft"], input[value="brouillon"], label:has-text("Brouillon") input').first()
    .click().catch(async () => {
      await page.locator('label:has-text("Brouillon")').first().click().catch(() => {})
    })
  await page.locator('button:has-text("Publier"), button:has-text("Créer")').first().click()
  await page.waitForURL((url) => !url.href.includes('/products/new'), { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('load')

  // Extract product ID from URL
  const directMatch = page.url().match(/\/products\/([^/?#/]+)/)
  if (directMatch && directMatch[1] !== 'new') return directMatch[1]

  // Redirected to list — click matching row
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

async function lmEdit(page: Page, platformId: string, product: ProductDetail): Promise<void> {
  const price = product.prices.libre_market?.price
  await page.goto(`https://libre-market.com/m/coincart/admin/products/${platformId}/edit`)
  await page.waitForLoadState('load')
  const nameField = page.locator('input[name="name"], input[name="title"], input[name="nom"]').first()
  if (await nameField.count() > 0) await nameField.fill(product.title)
  if (price) {
    const priceField = page.locator('input[name="price"], input[name="prix"]').first()
    if (await priceField.count() > 0) await priceField.fill(String(price))
  }
  const saveBtn = page.locator(
    'button:has-text("Enregistrer"), button:has-text("Mettre à jour"), button:has-text("Sauvegarder"), button[type="submit"]'
  ).first()
  if (await saveBtn.count() > 0) { await saveBtn.click(); await page.waitForLoadState('load') }
}

// ---------------------------------------------------------------------------
// XMR Bazaar automation
// ---------------------------------------------------------------------------

async function xmrLogin(page: Page, username: string, password: string): Promise<void> {
  console.log('  🔐 Logging in to XMR Bazaar...')
  await page.goto('https://xmrbazaar.com/login/')
  await page.waitForLoadState('domcontentloaded')
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
  const rem = page.locator('input[name="remember_me"], label:has-text("Remember me") input').first()
  if (await rem.count() > 0) await rem.check().catch(() => {})
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  if (page.url().includes('/login')) throw new Error('XMR Bazaar login failed — check credentials')
}

async function xmrLogout(page: Page): Promise<void> {
  await page.goto('https://xmrbazaar.com/logout/')
  await page.waitForLoadState('load')
}

async function xmrFillForm(page: Page, product: ProductDetail, imagePaths: string[], isEdit = false): Promise<void> {
  const price = product.prices.xmr_bazaar?.price ?? 0
  const desc  = stripHtml(product.description ?? product.title)

  await page.locator('select[name="category"]').selectOption({ label: 'Electronics' }).catch(() => {})
  await page.locator('input[name="title"]').fill(product.title)
  await page.locator('input[name="price"]').fill(String(price))
  await page.locator('select[name="currency"]').selectOption({ label: 'EUR (€)' }).catch(async () => {
    await page.locator('select[name="currency"]').selectOption({ value: 'eur' }).catch(() => {})
  })
  await page.locator('textarea[name="description"]').fill(desc)
  await page.locator('input[name="tags"]').fill('electronics').catch(() => {})

  if (!isEdit && imagePaths.length > 0) {
    await page.locator('input[type="file"]').first().setInputFiles(imagePaths[0])
    await page.waitForTimeout(1000)
    for (let i = 1; i < Math.min(imagePaths.length, 4); i++) {
      if (i > 1) {
        await page.evaluate(() => {
          const labels = document.querySelectorAll<HTMLElement>('label.additional-photo-add')
          if (labels.length > 0) labels[labels.length - 1].click()
        })
        await page.waitForTimeout(500)
      }
      const inputs = await page.locator('input[type="file"]').all()
      if (inputs[i]) { await inputs[i].setInputFiles(imagePaths[i]); await page.waitForTimeout(800) }
    }
    await page.locator('text=Physical').first().click()
    await page.waitForTimeout(500)
    const countrySel = page.locator('select[name*="country" i]').first()
    if (await countrySel.count() > 0) await countrySel.selectOption({ label: 'Poland' }).catch(() => {})
    const intlShipping = page.locator('input[id="international_shipping"]')
    if (await intlShipping.count() > 0) {
      await intlShipping.click({ force: true })
      await page.waitForTimeout(300)
      await page.locator('input[name="international_shipping_price"]').first().fill('10').catch(() => {})
    }
    await page.locator('text=Unlimited stock').first().click().catch(() => {})
  }

  await page.locator('text=I confirm that my listing').first().click()
}

async function xmrCreate(page: Page, product: ProductDetail, imagePaths: string[]): Promise<string> {
  await page.goto('https://xmrbazaar.com/new-listing/selling/sell-product/')
  await page.waitForLoadState('load')
  await xmrFillForm(page, product, imagePaths)
  await page.locator('text=Save as draft').click()
  await page.waitForSelector('text=Draft saved', { timeout: 20000 })
  const href     = await page.locator('a[href*="/listing/"]').first().getAttribute('href') ?? ''
  const m        = href.match(/\/listing\/([A-Za-z0-9]+)\//)
  const listingId = m ? m[1] : ''
  if (!listingId) throw new Error('Could not extract XMR Bazaar listing ID')
  return listingId
}

async function xmrEdit(page: Page, platformId: string, product: ProductDetail, imagePaths: string[]): Promise<void> {
  await page.goto(`https://xmrbazaar.com/listing/${platformId}/`)
  await page.waitForLoadState('load')
  const editLink = page.locator('a[href*="/edit"], a:has-text("Edit")').first()
  if (await editLink.count() === 0) throw new Error(`No Edit button found for listing ${platformId}`)
  await editLink.click()
  await page.waitForLoadState('load')
  await xmrFillForm(page, product, imagePaths, true)
  await page.locator('text=Update Listing').click()
  await page.waitForLoadState('load')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function processPlatform(
  platform: 'libre_market' | 'xmr_bazaar',
  vars: Record<string, string>,
  token: string,
  apiBase: string
): Promise<void> {
  console.log(`\n${'='.repeat(50)}\n${platform.toUpperCase()}\n${'='.repeat(50)}`)

  const skus = await getQueuedSkus(platform, token, apiBase)
  if (skus.length === 0) { console.log('  Nothing queued.'); return }
  console.log(`  ${skus.length} product(s) queued: ${skus.join(', ')}`)
  if (IS_DRY_RUN) { console.log('  [dry-run] Skipping.'); return }

  // Fetch full product data for all queued SKUs
  const products: ProductDetail[] = []
  for (const sku of skus) {
    try {
      const p = await getProductDetail(sku, token, apiBase)
      if (!p.prices[platform]?.price) {
        console.log(`  ⚠️  Skipping ${sku}: no price set for ${platform}`)
        continue
      }
      products.push(p)
    } catch (err) {
      console.log(`  ⚠️  Skipping ${sku}: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (products.length === 0) { console.log('  No eligible products after checks.'); return }

  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  const page    = await browser.newPage()
  page.setDefaultTimeout(30000)

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
      if (!username || !password) throw new Error('XMR_BAZAAR_USERNAME or XMR_BAZAAR_PASSWORD not set in .dev.vars')
      await xmrLogin(page, username, password)
    }

    // Process each product
    for (const product of products) {
      console.log(`\n  → ${product.id}: ${product.title.slice(0, 50)}`)

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

      try {
        let platformId: string
        if (isNew) {
          console.log('    Creating new listing...')
          platformId = platform === 'libre_market'
            ? await lmCreate(page, product, imagePaths)
            : await xmrCreate(page, product, imagePaths)
          console.log(`    ✅ Created → ${platformId}`)
        } else {
          platformId = mapping!.platformId
          console.log(`    Editing existing listing ${platformId}...`)
          if (platform === 'libre_market') await lmEdit(page, platformId, product)
          else await xmrEdit(page, platformId, product, imagePaths)
          console.log(`    ✅ Updated`)
        }
        await markDone(product.id, platform, platformId, isNew, token, apiBase)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`    ❌ Failed: ${msg}`)
        await page.screenshot({
          path: path.join(process.cwd(), 'scripts', `error-${platform}-${product.id}.png`),
          fullPage: true,
        })
      }

      // Cleanup temp images
      for (const p of imagePaths) fs.unlink(p, () => {})
    }

    // Logout
    if (platform === 'libre_market') await lmLogout(page)
    else await xmrLogout(page)
    console.log('\n  Logged out.')

  } finally {
    await page.waitForTimeout(2000)
    await browser.close()
  }
}

async function main() {
  const vars    = readDevVars()
  const token   = vars['AGENT_BEARER_TOKEN']
  const apiBase = IS_LOCAL
    ? 'http://127.0.0.1:8787'
    : (vars['WIZHARD_URL'] ?? (() => { throw new Error('Set WIZHARD_URL in .dev.vars or use --local') })())

  if (!token) { console.error('❌ AGENT_BEARER_TOKEN not set in .dev.vars'); process.exit(1) }

  console.log(`API: ${apiBase}${IS_DRY_RUN ? ' [dry-run]' : ''}`)

  const platforms: Array<'libre_market' | 'xmr_bazaar'> = ONLY_PLATFORM
    ? [ONLY_PLATFORM as 'libre_market' | 'xmr_bazaar']
    : ['libre_market', 'xmr_bazaar']

  for (const platform of platforms) {
    await processPlatform(platform, vars, token, apiBase)
  }

  console.log('\n✅ All done.')
}

main().catch((err) => { console.error(err); process.exit(1) })
