/**
 * XMR Bazaar — Playwright connector test
 * Full connector flow: login (remember me) → for each product: edit or create → logout
 * Run: npx tsx scripts/test-xmrbazaar.ts
 * Credentials read from .dev.vars
 */

import { chromium, type Browser, type Page } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Read .dev.vars
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

// ---------------------------------------------------------------------------
// Download a test image to a local path
// ---------------------------------------------------------------------------

async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`  Downloaded ${url} → ${dest} (${buf.length} bytes)`)
}

// ---------------------------------------------------------------------------
// Screenshot helper
// ---------------------------------------------------------------------------

async function shot(page: Page, name: string) {
  const p = path.join(process.cwd(), 'scripts', `screenshot-${name}.png`)
  await page.screenshot({ path: p, fullPage: true })
  console.log(`  📸 ${name} → ${p}`)
}

// ---------------------------------------------------------------------------
// Product data shape (what the real connector will receive)
// ---------------------------------------------------------------------------

interface ListingData {
  sku:         string
  title:       string
  description: string
  price:       number
  currency:    string         // e.g. 'EUR'
  tags:        string         // comma-separated
  images:      string[]       // local file paths
  country:     string         // warehouse country (e.g. 'Poland')
  shippingCost: number        // international shipping cost in EUR
  category:    string         // XMR Bazaar category label (e.g. 'Electronics')
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(page: Page, username: string, password: string): Promise<void> {
  console.log('\n🔐 Logging in...')
  await page.goto('https://xmrbazaar.com/login/')
  await page.waitForLoadState('domcontentloaded')
  await shot(page, '01-login-page')

  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)

  // Check "Remember me" so the session persists between runs
  const rememberMe = page.locator('input[name="remember_me"], input[id="remember_me"], label:has-text("Remember me") input')
  if (await rememberMe.count() > 0) {
    console.log('  Checking Remember me')
    await rememberMe.first().check().catch(() =>
      page.locator('label:has-text("Remember me")').click()
    )
  }

  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  console.log('  URL after login:', page.url())
  if (page.url().includes('/login')) {
    throw new Error('Login failed — still on /login/ page. Check credentials.')
  }
  await shot(page, '02-after-login')
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function logout(page: Page): Promise<void> {
  console.log('\n🚪 Logging out...')
  await page.goto('https://xmrbazaar.com/logout/')
  await page.waitForLoadState('load')
  console.log('  Logged out. URL:', page.url())
}

// ---------------------------------------------------------------------------
// Fill the listing form (shared between create and edit)
// ---------------------------------------------------------------------------

async function fillForm(page: Page, data: ListingData, moneroAddr: string, isEdit = false): Promise<void> {
  // Category — use name="category" to avoid hitting select[name="status"] on edit form
  console.log(`  Category: ${data.category}`)
  await page.locator('select[name="category"]').selectOption({ label: data.category })

  // Title
  console.log(`  Title: ${data.title}`)
  await page.locator('input[name="title"]').fill(data.title)

  // Price + Currency
  console.log(`  Price: ${data.price} ${data.currency}`)
  await page.locator('input[name="price"]').fill(String(data.price))
  const currencySelect = page.locator('select[name="currency"]')
  await currencySelect.selectOption({ label: `${data.currency} (€)` }).catch(async () => {
    await currencySelect.selectOption({ value: data.currency.toLowerCase() }).catch(() => {})
  })

  // Description
  console.log('  Description')
  await page.locator('textarea[name="description"]').fill(data.description)

  // Tags
  console.log(`  Tags: ${data.tags}`)
  await page.locator('input[name="tags"]').fill(data.tags)

  // Photos — skip on edit (already uploaded, re-uploading would add duplicates)
  if (!isEdit) {
    if (data.images.length > 0) {
      console.log('  Uploading main photo')
      const fileInputs = page.locator('input[type="file"]')
      await fileInputs.first().setInputFiles(data.images[0])
      await page.waitForTimeout(1000)
    }
    for (let i = 1; i < data.images.length; i++) {
      if (i > 1) {
        console.log(`    Clicking + to add slot ${i}`)
        await page.evaluate(() => {
          const labels = document.querySelectorAll<HTMLElement>('label.additional-photo-add')
          if (labels.length > 0) labels[labels.length - 1].click()
        })
        await page.waitForTimeout(500)
      }
      const allInputs = await page.locator('input[type="file"]').all()
      const targetInput = allInputs[i]
      if (targetInput) {
        await targetInput.setInputFiles(data.images[i])
        await page.waitForTimeout(800)
        console.log(`    Uploaded additional photo ${i}`)
      }
    }
  } else {
    console.log('  Photos: skipped (edit mode — already uploaded)')
  }

  // Delivery — skip on edit (already configured, re-clicking would toggle state)
  if (!isEdit) {
    console.log('  Delivery: Physical')
    await page.locator('text=Physical').first().click()
  await page.waitForTimeout(500)

  const locationTypes = await page.evaluate(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[name="location_type"]')
    return Array.from(inputs).map((inp) => ({ id: inp.id, value: inp.value }))
  })
  const chosen = locationTypes.find((lt) => lt.value === 'local') ?? locationTypes[0]
  if (chosen) {
    const lbl = page.locator(`label[for="${chosen.id}"]`)
    if (await lbl.count() > 0) {
      await lbl.scrollIntoViewIfNeeded()
      await lbl.click()
    } else {
      await page.evaluate((id) => {
        const inp = document.getElementById(id) as HTMLInputElement | null
        if (inp) { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })) }
      }, chosen.id)
    }
    await page.waitForTimeout(400)
  }

  // Country
  const countrySelect = page.locator('select[name*="country" i], select[id*="country" i]').first()
  if (await countrySelect.count() > 0) {
    console.log(`  Country: ${data.country}`)
    await countrySelect.scrollIntoViewIfNeeded()
    await countrySelect.selectOption({ label: data.country })
    await page.waitForTimeout(300)
  }

  // International shipping + cost
  const intlShipping = page.locator('input[id="international_shipping"]')
  if (await intlShipping.count() > 0) {
    console.log(`  International shipping cost: ${data.shippingCost}`)
    await intlShipping.click({ force: true })
    await page.waitForTimeout(300)
    const intlCost = page.locator('input[name="international_shipping_price"]').first()
    if (await intlCost.count() > 0) await intlCost.fill(String(data.shippingCost))
  }
  } else {
    console.log('  Delivery/payment: skipped (edit mode — already configured)')
  }

  // Stock → Unlimited (also skip on edit — already set)
  if (!isEdit) {
    console.log('  Stock: Unlimited')
    await page.locator('text=Unlimited stock').first().click()
  }

  // Terms
  console.log('  Checking terms')
  await page.locator('text=I confirm that my listing').first().click()
}

// ---------------------------------------------------------------------------
// Create a new listing — returns the listing ID (4-char code, e.g. "HKcf")
// ---------------------------------------------------------------------------

async function createListing(page: Page, data: ListingData, moneroAddr: string): Promise<string> {
  console.log(`\n➕ Creating new listing for SKU: ${data.sku}`)
  await page.goto('https://xmrbazaar.com/new-listing/selling/sell-product/')
  await page.waitForLoadState('load')

  await fillForm(page, data, moneroAddr)
  await shot(page, `create-form-${data.sku}`)

  console.log('  💾 Saving as draft...')
  await page.locator('text=Save as draft').click()
  // Page stays at same URL — wait for "Draft saved!" confirmation text
  await page.waitForSelector('text=Draft saved', { timeout: 20000 })

  // Extract listing URL from the title link or "View your listing" button
  const listingHref = await page.locator('a[href*="/listing/"]').first().getAttribute('href') ?? ''
  const match       = listingHref.match(/\/listing\/([A-Za-z0-9]+)\//)
  const listingId   = match ? match[1] : ''
  const listingUrl  = listingId ? `https://xmrbazaar.com/listing/${listingId}/` : '(unknown)'
  console.log(`  ✅ Listing created — URL: ${listingUrl}  ID: ${listingId}`)
  await shot(page, `create-success-${data.sku}`)
  return listingId
}

// ---------------------------------------------------------------------------
// Edit an existing listing
// ---------------------------------------------------------------------------

async function editListing(page: Page, listingId: string, data: ListingData, moneroAddr: string): Promise<void> {
  console.log(`\n✏️  Editing existing listing ${listingId} for SKU: ${data.sku}`)

  // Navigate to the listing page first, then find the Edit button
  await page.goto(`https://xmrbazaar.com/listing/${listingId}/`)
  await page.waitForLoadState('load')

  // Find and click Edit link/button
  const editLink = page.locator('a[href*="/edit"], a:has-text("Edit"), button:has-text("Edit")').first()
  if (await editLink.count() === 0) {
    throw new Error(`No Edit button found on listing ${listingId}. Check if you are the owner.`)
  }
  await editLink.click()
  await page.waitForLoadState('load')
  console.log('  Opened edit form:', page.url())
  await shot(page, `edit-form-${data.sku}`)

  await fillForm(page, data, moneroAddr, true)

  console.log('  💾 Updating listing...')
  await page.locator('text=Update Listing').click()
  await page.waitForLoadState('load')
  console.log(`  ✅ Listing ${listingId} updated. URL: ${page.url()}`)
  await shot(page, `edit-success-${data.sku}`)
}

// ---------------------------------------------------------------------------
// SyncDash API helpers — update DB after successful browser push
// ---------------------------------------------------------------------------

async function syncDashApiCall(
  method: string,
  apiPath: string,
  body: unknown,
  bearerToken: string,
  apiBase = 'http://127.0.0.1:8787'
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}${apiPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.log(`  ⚠️  API ${method} ${apiPath} → ${res.status}: ${text.slice(0, 100)}`)
      return false
    }
    return true
  } catch (err) {
    console.log(`  ⚠️  API call failed (server down?): ${err instanceof Error ? err.message : err}`)
    return false
  }
}

async function savePushResult(
  sku: string,
  platform: 'libre_market' | 'xmr_bazaar',
  platformId: string,
  isNew: boolean,
  bearerToken: string
): Promise<void> {
  if (!sku || sku === 'TEST-001') {
    console.log('  (skipping API update for test SKU)')
    return
  }
  if (!bearerToken) {
    console.log('  ⚠️  No AGENT_BEARER_TOKEN — skipping DB update')
    return
  }

  // Save platform mapping if newly created
  if (isNew && platformId) {
    const ok = await syncDashApiCall('POST', '/api/mappings', {
      productId: sku, platform, platformId, recordType: 'product',
    }, bearerToken)
    if (ok) console.log(`  ✅ Saved platformId="${platformId}" to platform_mappings`)
  }

  // Update push status to done
  const ok = await syncDashApiCall('PATCH', `/api/products/${sku}/push-status`, {
    platform, status: 'done',
  }, bearerToken)
  if (ok) console.log(`  ✅ Marked ${sku} pushed_${platform} = done`)
}

// ---------------------------------------------------------------------------
// Main — test with one dummy product
// ---------------------------------------------------------------------------

async function main() {
  const vars        = readDevVars()
  const username    = vars['XMR_BAZAAR_USERNAME']
  const password    = vars['XMR_BAZAAR_PASSWORD']
  const moneroAddr  = vars['XMR_BAZAAR_MONERO_ADDRESS'] || ''

  if (!username || !password) {
    console.error('❌ XMR_BAZAAR_USERNAME or XMR_BAZAAR_PASSWORD not set in .dev.vars')
    process.exit(1)
  }

  // Download 4 test images (main + 3 additional)
  const imgDir   = path.join(process.cwd(), 'scripts')
  const imgPaths = [0, 1, 2, 3].map((i) => path.join(imgDir, `test-img-${i}.jpg`))

  console.log('📥 Checking test images...')
  for (let i = 0; i < 4; i++) {
    if (!fs.existsSync(imgPaths[i])) {
      await downloadImage(`https://picsum.photos/seed/syncdash${i}/800/600`, imgPaths[i])
    }
  }

  // Dummy product for testing
  const testProduct: ListingData = {
    sku:          'TEST-001',
    title:        '[TEST SYNCDASH] Acer Monitor 27" FHD — DO NOT BUY',
    description:  '[TEST LISTING — DO NOT BUY]\n\nThis is an automated test from SyncDash browser automation. Acer 27-inch Full HD IPS monitor, 75Hz, HDMI/VGA.\n\nPlease ignore this listing.',
    price:        15999,
    currency:     'EUR',
    tags:         'monitor, acer, electronics, test',
    images:       imgPaths,
    country:      'Poland',
    shippingCost: 10,
    category:     'Electronics',
  }

  // Optional: pass an existing listing ID as CLI arg to test the edit flow
  // e.g. npx tsx scripts/test-xmrbazaar.ts HKcf
  const existingListingId = process.argv[2] || ''

  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const page    = await browser.newPage()
  page.setDefaultTimeout(30000)

  try {
    // 1. Login ONCE
    await login(page, username, password)

    // 2. Process product: edit if listing exists, create if not
    let listingId: string
    if (existingListingId) {
      console.log(`\n🔍 Existing listing ID provided: ${existingListingId} → editing`)
      await editListing(page, existingListingId, testProduct, moneroAddr)
      listingId = existingListingId
      await savePushResult(testProduct.sku, 'xmr_bazaar', listingId, false, vars['AGENT_BEARER_TOKEN'] ?? '')
    } else {
      console.log('\n🔍 No existing listing ID → creating new')
      listingId = await createListing(page, testProduct, moneroAddr)
      await savePushResult(testProduct.sku, 'xmr_bazaar', listingId, true, vars['AGENT_BEARER_TOKEN'] ?? '')
    }

    // 3. Report result
    const listingUrl = `https://xmrbazaar.com/listing/${listingId}/`
    console.log(`\n📋 Result:`)
    console.log(`  SKU:        ${testProduct.sku}`)
    console.log(`  Listing ID: ${listingId}`)
    console.log(`  URL:        ${listingUrl}`)

    // 4. Logout
    await logout(page)

    console.log('\n✅ Test complete!')
    if (!existingListingId && listingId) {
      console.log(`\n  💡 To test the edit flow, run again with:`)
      console.log(`     npx tsx scripts/test-xmrbazaar.ts ${listingId}`)
    }

  } catch (err) {
    console.error('\n❌ Error:', err)
    await shot(page, 'ERROR')
    throw err
  } finally {
    await page.waitForTimeout(3000)
    await browser.close()
  }
}

main().catch(() => process.exit(1))
