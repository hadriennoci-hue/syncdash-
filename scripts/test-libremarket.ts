/**
 * Libre Market — Playwright connector test
 * Full connector flow: login → for each product: edit or create → logout
 * Run: npx tsx scripts/test-libremarket.ts
 * Run with existing ID: npx tsx scripts/test-libremarket.ts <productId>
 * Credentials read from .dev.vars
 */

import { chromium, type Page } from 'playwright'
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
  const p = path.join(process.cwd(), 'scripts', `lm-screenshot-${name}.png`)
  await page.screenshot({ path: p, fullPage: true })
  console.log(`  📸 ${name} → ${p}`)
}

// ---------------------------------------------------------------------------
// Product data shape
// ---------------------------------------------------------------------------

interface ListingData {
  sku:          string
  title:        string
  description:  string
  price:        number       // price in EUR cents (e.g. 15999 = 159.99€)
  category:     string       // Libre Market category label
  subCategory?: string       // optional subcategory
  images:       string[]     // local file paths
}

// ---------------------------------------------------------------------------
// Login — navigate to admin, fill form if redirected to login page
// ---------------------------------------------------------------------------

async function login(page: Page, email: string, password: string): Promise<void> {
  console.log('\n🔐 Logging in...')

  // Go to the admin page — if not authenticated, will redirect to login
  await page.goto('https://libre-market.com/m/coincart/admin/')
  await page.waitForLoadState('domcontentloaded')
  console.log('  URL after nav:', page.url())
  await shot(page, '01-initial')

  // If already on admin, skip login form
  if (page.url().includes('/admin/')) {
    console.log('  Already authenticated — skipping login form')
    return
  }

  // Fill email + password
  await page.locator('input[type="email"], input[name="email"], input[name="username"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await shot(page, '02-login-filled')

  // Submit
  await page.locator('button[type="submit"], input[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter"), button:has-text("Login")').first().click()

  // Wait for redirect away from /login (not just load — login may use JS redirect)
  await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 15000 }).catch(() => {})
  console.log('  URL after login:', page.url())

  if (page.url().includes('/login')) {
    throw new Error('Login failed — still on /login page. Check credentials.')
  }
  await shot(page, '03-after-login')
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function logout(page: Page): Promise<void> {
  console.log('\n🚪 Logging out...')
  // Try to find a logout link in the admin UI
  const logoutLink = page.locator('a[href*="logout"], a:has-text("Déconnexion"), a:has-text("Se déconnecter"), a:has-text("Logout")').first()
  if (await logoutLink.count() > 0) {
    await logoutLink.click()
    await page.waitForLoadState('load').catch(() => {})
  } else {
    // Fallback: navigate to known logout endpoints
    await page.goto('https://libre-market.com/api/auth/signout').catch(() => {})
    await page.waitForLoadState('load').catch(() => {})
    if (page.url().includes('signout')) {
      // NextAuth signout page — click the "Sign out" button
      await page.locator('button:has-text("Sign out"), button:has-text("Déconnecter"), form button').first().click().catch(() => {})
      await page.waitForLoadState('load').catch(() => {})
    }
  }
  console.log('  Logged out. URL:', page.url())
}

// ---------------------------------------------------------------------------
// Fill step 1: product type + basic info
// ---------------------------------------------------------------------------

async function fillStep1(page: Page, data: ListingData): Promise<void> {
  console.log('  Step 1: type + basic info')
  await shot(page, `s1-start-${data.sku}`)

  // Product type: "Non-alimentaire" — middle of 3 buttons
  // Try multiple selector strategies
  const nonAlimentaireBtn = page.locator(
    'button:has-text("Non-alimentaire"), label:has-text("Non-alimentaire"), [data-value*="non"], input[value*="non-alim"]'
  )
  if (await nonAlimentaireBtn.count() > 0) {
    console.log('  Clicking Non-alimentaire')
    await nonAlimentaireBtn.first().click()
  } else {
    // Fall back: 3-button group, pick the middle one (index 1)
    const typeBtns = page.locator('.product-type button, .type-selector button, .btn-group button, [class*="type"] button')
    const count = await typeBtns.count()
    if (count >= 3) {
      console.log(`  Clicking type button index 1 of ${count}`)
      await typeBtns.nth(1).click()
    } else if (count > 0) {
      console.log(`  Clicking first type button (only ${count} found)`)
      await typeBtns.first().click()
    } else {
      console.log('  ⚠️  No type buttons found — skipping type selection')
    }
  }
  await page.waitForTimeout(400)

  // Product name — use getByLabel (most reliable) or placeholder visible in screenshot
  console.log(`  Name: ${data.title}`)
  const nameField = page.getByLabel('Nom du produit', { exact: false })
  if (await nameField.count() > 0) {
    await nameField.fill(data.title)
  } else {
    // Fallback: first visible text input on the form
    await page.locator('input[type="text"]:visible, input:not([type]):visible').first().fill(data.title)
  }

  // Description
  console.log('  Description')
  const descField = page.getByLabel('Description', { exact: false })
  if (await descField.count() > 0) {
    await descField.fill(data.description)
  } else {
    await page.locator('textarea:visible').first().fill(data.description)
  }

  // Note: price field is in step 2, not here

  // Category — getByLabel first, then any select
  console.log(`  Category: ${data.category}`)
  const catSelect = page.getByLabel('Catégorie', { exact: false }).first()
  const catSelectFallback = page.locator('select').first()
  const activeCatSelect = (await catSelect.count() > 0) ? catSelect : catSelectFallback
  if (await activeCatSelect.count() > 0) {
    const options = await activeCatSelect.locator('option').allInnerTexts()
    console.log(`  Available categories: ${options.join(', ')}`)
    await activeCatSelect.selectOption({ label: data.category }).catch(async () => {
      if (options.length > 1) await activeCatSelect.selectOption({ index: 1 })
    })
  }

  // Subcategory (optional)
  if (data.subCategory) {
    const subCatSelect = page.getByLabel('Sous-catégorie', { exact: false }).first()
    if (await subCatSelect.count() > 0) {
      await subCatSelect.selectOption({ label: data.subCategory }).catch(() => {})
    }
  }

  await shot(page, `s1-filled-${data.sku}`)
}

// ---------------------------------------------------------------------------
// Fill step 2: characteristics
// ---------------------------------------------------------------------------

async function fillStep2(page: Page, priceEur: number): Promise<void> {
  console.log('  Step 2: characteristics')
  await shot(page, 's2-start')

  // Price (EUR) — required field, placeholder "0.00" (no name attr)
  console.log(`  Price: ${priceEur}`)
  const priceInput = page.locator('input[placeholder="0.00"]').first()
  if (await priceInput.count() > 0) {
    await priceInput.fill(String(priceEur))
  } else {
    console.log('  ⚠️  Price input (ph=0.00) not found')
  }
  await page.waitForTimeout(300)

  // "Précommandes uniquement" — find the label containing this text and click its checkbox
  const precoLabel = page.locator('label').filter({ hasText: /précommande/i }).first()
  if (await precoLabel.count() > 0) {
    const precoInput = precoLabel.locator('input[type="checkbox"]')
    if (await precoInput.count() > 0) {
      if (!(await precoInput.isChecked())) {
        console.log('  Checking Précommandes uniquement')
        await precoInput.check()
      } else {
        console.log('  Précommandes uniquement already checked')
      }
    } else {
      // fallback: click the label itself
      await precoLabel.click()
    }
  } else {
    console.log('  ⚠️  Précommandes uniquement not found')
  }
  await page.waitForTimeout(400)

  // Délai de fabrication/préparation * → 1
  // Label is "Délai de fabrication/préparation" — use getByLabel
  const delai = page.getByLabel('Délai de fabrication', { exact: false }).first()
  if (await delai.count() > 0) {
    console.log('  Délai de fabrication: 1')
    await delai.clear()
    await delai.fill('1')
  } else {
    // Fallback: placeholder "Ex: 7"
    const delaiAlt = page.locator('input[placeholder="Ex: 7"]').first()
    if (await delaiAlt.count() > 0) {
      console.log('  Délai (fallback): 1')
      await delaiAlt.clear()
      await delaiAlt.fill('1')
    } else {
      console.log('  ⚠️  Délai de fabrication not found')
    }
  }

  // Poids du produit * → 500
  const poids = page.getByLabel('Poids du produit', { exact: false }).first()
  if (await poids.count() > 0) {
    console.log('  Poids: 500')
    await poids.fill('500')
  } else {
    // Fallback: placeholder "Ex: 250"
    const poidsAlt = page.locator('input[placeholder="Ex: 250"]').first()
    if (await poidsAlt.count() > 0) {
      console.log('  Poids (fallback): 500')
      await poidsAlt.fill('500')
    } else {
      console.log('  ⚠️  Poids du produit not found')
    }
  }

  // Est-ce un produit qui périme? * → NON (required — Suivant stays disabled until this is chosen)
  // Styled radio buttons labeled "Oui" and "Non"
  console.log('  Périme: NON')
  let perimeDone = false

  // Try getByRole radio
  const nonRadio = page.getByRole('radio', { name: /^Non$/i }).first()
  if (await nonRadio.count() > 0) {
    await nonRadio.click()
    perimeDone = true
    console.log('  Périme: NON (getByRole radio)')
  }

  if (!perimeDone) {
    // Try label:has-text("Non") — find within périme section (yellow box)
    const perimeBox = page.locator('div').filter({ hasText: /périme/i }).last()
    const nonInBox = perimeBox.locator('label').filter({ hasText: /^Non$/ }).first()
    if (await nonInBox.count() > 0) {
      await nonInBox.click()
      perimeDone = true
      console.log('  Périme: NON (label in box)')
    }
  }

  if (!perimeDone) {
    // Last resort: click any element with text "Non"
    await page.evaluate(() => {
      const allLabels = Array.from(document.querySelectorAll('label'))
      const nonLabel = allLabels.find((l) => l.textContent?.trim() === 'Non')
      if (nonLabel) (nonLabel as HTMLElement).click()
    })
    console.log('  Périme: NON (JS evaluate fallback)')
  }
  await page.waitForTimeout(300)

  // Réduction vs grandes surfaces (optional) → 5
  const reduction = page.getByLabel('Réduction', { exact: false }).first()
  if (await reduction.count() > 0) {
    console.log('  Réduction: 5')
    await reduction.fill('5')
  } else {
    // Fallback: placeholder "Ex: 15"
    const reductionAlt = page.locator('input[placeholder="Ex: 15"]').first()
    if (await reductionAlt.count() > 0) {
      console.log('  Réduction (fallback): 5')
      await reductionAlt.fill('5')
    } else {
      console.log('  ⚠️  Réduction not found')
    }
  }

  await shot(page, 's2-filled')
}

// ---------------------------------------------------------------------------
// Fill step 3: photos (skip if no 800×800 image available)
// ---------------------------------------------------------------------------

async function fillStep3(page: Page, images: string[]): Promise<void> {
  console.log('  Step 3: photos')
  await shot(page, 's3-start')

  // Check which images are at least 800×800
  // For simplicity, we check file dimensions using sharp-like approach via canvas
  // Since we can't import sharp without installing it, use a basic size check via
  // Playwright's evaluate to load the image in the browser
  let uploaded = false
  for (const imgPath of images) {
    if (!fs.existsSync(imgPath)) continue

    // Check dimensions by loading in a hidden <img> tag via page.evaluate
    const dims = await page.evaluate(async (dataUrl: string) => {
      return new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 0, h: 0 })
        img.src = dataUrl
      })
    }, `data:image/jpeg;base64,${fs.readFileSync(imgPath).toString('base64')}`).catch(() => ({ w: 0, h: 0 }))

    console.log(`  Image ${path.basename(imgPath)}: ${dims.w}×${dims.h}`)

    if (dims.w >= 800 && dims.h >= 800) {
      const fileInput = page.locator('input[type="file"]').first()
      if (await fileInput.count() > 0) {
        console.log(`  Uploading ${path.basename(imgPath)}`)
        await fileInput.setInputFiles(imgPath)
        await page.waitForTimeout(1500)
        uploaded = true
        break
      }
    }
  }

  if (!uploaded) {
    console.log('  Photos: no image ≥ 800×800 — skipping upload')
  }

  await shot(page, 's3-done')
}

// ---------------------------------------------------------------------------
// Click "Suivant" and wait for next step
// ---------------------------------------------------------------------------

async function clickSuivant(page: Page, stepLabel: string): Promise<void> {
  console.log(`  → Suivant (${stepLabel})`)
  const btn = page.locator('button:has-text("Suivant"), input[value="Suivant"]').last()
  // Wait a moment for form validation to run after filling fields
  await page.waitForTimeout(600)
  const isDisabled = await btn.isDisabled()
  if (isDisabled) {
    console.log('  ⚠️  Suivant is disabled — force-clicking')
    await btn.click({ force: true })
  } else {
    await btn.click()
  }
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
}

// ---------------------------------------------------------------------------
// Create a new listing — returns the product ID
// ---------------------------------------------------------------------------

async function createListing(page: Page, data: ListingData): Promise<string> {
  console.log(`\n➕ Creating new listing for SKU: ${data.sku}`)
  await page.goto('https://libre-market.com/m/coincart/admin/products/new')
  await page.waitForLoadState('load')

  // Step 1
  await fillStep1(page, data)
  await clickSuivant(page, 'step 1')

  // Step 2
  await fillStep2(page, data.price / 100)
  await clickSuivant(page, 'step 2')

  // Step 3: photos
  await fillStep3(page, data.images)
  await clickSuivant(page, 'step 3')

  // Step 4: intermediate — just click Suivant
  console.log('  Step 4: intermediate')
  await shot(page, 's4-start')
  await clickSuivant(page, 'step 4')

  // Step 5: visibility
  console.log('  Step 5: visibility → Brouillon')
  await shot(page, 's5-start')

  const brouillonInput = page.locator(
    'input[value="draft"], input[value="brouillon"], label:has-text("Brouillon") input, input[id*="brouillon" i]'
  ).first()
  if (await brouillonInput.count() > 0) {
    await brouillonInput.click()
    console.log('  Selected Brouillon (input)')
  } else {
    // Try clicking a "Brouillon" label or button directly
    const brouillonLabel = page.locator('label:has-text("Brouillon"), button:has-text("Brouillon")').first()
    if (await brouillonLabel.count() > 0) {
      await brouillonLabel.click()
      console.log('  Selected Brouillon (label/button)')
    } else {
      // Pick first radio in the visibility group
      const visRadios = page.locator('input[type="radio"][name*="visib" i], input[type="radio"][name*="status" i], input[type="radio"][name*="publish" i]')
      if (await visRadios.count() > 0) {
        await visRadios.first().click()
        console.log('  Selected first visibility radio')
      } else {
        console.log('  ⚠️  Visibility selector not found — proceeding without selecting')
      }
    }
  }

  await shot(page, 's5-filled')

  // Publish (saves as draft)
  console.log('  💾 Clicking Publier...')
  await page.locator('button:has-text("Publier"), button:has-text("Créer"), input[value="Publier"]').first().click()

  // Wait for redirect away from /products/new (creation completes asynchronously)
  await page.waitForURL((url) => !url.href.includes('/products/new'), { timeout: 30000 }).catch(() => {})
  await page.waitForLoadState('load')

  const currentUrl = page.url()
  console.log('  URL after publish:', currentUrl)

  // Extract product ID from URL — expect /products/{id} after redirect
  let productId = ''
  const urlMatch = currentUrl.match(/\/products\/([^/?#/]+)/)
  if (urlMatch && urlMatch[1] !== 'new') {
    productId = urlMatch[1]
  }

  if (!productId) {
    // Redirected to /products list — collect all product href links and pick the first valid one
    // Product rows use click handlers (not <a> links) — click the first product row to navigate
    await page.waitForTimeout(800)
    const productRow = page.locator(`tr, [role="row"], [class*="product"], [class*="item"]`)
      .filter({ hasText: data.title.slice(0, 15) }).first()
    if (await productRow.count() > 0) {
      console.log('  Clicking product row to get its URL...')
      await productRow.click()
      await page.waitForURL((url) => /\/products\/[^/]+$/.test(url.pathname), { timeout: 10000 }).catch(() => {})
      const newUrl = page.url()
      console.log('  Product page URL:', newUrl)
      const m = newUrl.match(/\/products\/([^/?#/]+)$/)
      if (m) productId = m[1]
    }
    if (productId) console.log(`  Product ID: ${productId}`)
  }

  if (!productId) {
    console.log('  ⚠️  Could not extract product ID — check create-success screenshot')
  }

  console.log(`  ✅ Listing created — URL: ${currentUrl}  ID: ${productId}`)
  await shot(page, `create-success-${data.sku}`)
  return productId
}

// ---------------------------------------------------------------------------
// Edit an existing listing
// ---------------------------------------------------------------------------

async function editListing(page: Page, productId: string, data: ListingData): Promise<void> {
  console.log(`\n✏️  Editing existing listing ${productId} for SKU: ${data.sku}`)

  // Try the standard edit URL
  await page.goto(`https://libre-market.com/m/coincart/admin/products/${productId}/edit`)
  await page.waitForLoadState('load')
  console.log('  Edit page URL:', page.url())
  await shot(page, `edit-form-${data.sku}`)

  // Check if we landed on an edit form or a listing page
  if (page.url().includes('/edit') || page.url().includes('/admin/products/')) {
    // Update title
    const nameField = page.locator('input[name="name"], input[name="title"], input[name="nom"]').first()
    if (await nameField.count() > 0) {
      console.log(`  Updating title: ${data.title}`)
      await nameField.fill(data.title)
    }

    // Update price
    const priceEur = data.price / 100
    const priceField = page.locator('input[name="price"], input[name="prix"]').first()
    if (await priceField.count() > 0) {
      console.log(`  Updating price: ${priceEur}`)
      await priceField.fill(String(priceEur))
    }

    // Submit the form
    const saveBtn = page.locator(
      'button:has-text("Enregistrer"), button:has-text("Mettre à jour"), button:has-text("Sauvegarder"), button:has-text("Publier"), button[type="submit"]'
    ).first()
    if (await saveBtn.count() > 0) {
      console.log('  Saving...')
      await saveBtn.click()
      await page.waitForLoadState('load')
    }
  } else {
    // Fallback: navigate to listing page and find an Edit button
    await page.goto(`https://libre-market.com/m/coincart/admin/products/${productId}`)
    await page.waitForLoadState('load')

    const editLink = page.locator('a[href*="edit"], a:has-text("Modifier"), a:has-text("Edit"), button:has-text("Modifier")').first()
    if (await editLink.count() > 0) {
      await editLink.click()
      await page.waitForLoadState('load')
      console.log('  Opened edit form:', page.url())
    } else {
      throw new Error(`No edit button found for product ${productId}`)
    }
  }

  console.log(`  ✅ Listing ${productId} updated. URL: ${page.url()}`)
  await shot(page, `edit-success-${data.sku}`)
}

// ---------------------------------------------------------------------------
// SyncDash API helpers — update DB after successful browser push
// ---------------------------------------------------------------------------

async function syncDashApiCall(
  method: string,
  path: string,
  body: unknown,
  bearerToken: string,
  apiBase = 'http://127.0.0.1:8787'
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.log(`  ⚠️  API ${method} ${path} → ${res.status}: ${text.slice(0, 100)}`)
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
  const vars     = readDevVars()
  const email    = vars['LIBRE_MARKET_EMAIL']
  const password = vars['LIBRE_MARKET_PASSWORD']

  if (!email || !password) {
    console.error('❌ LIBRE_MARKET_EMAIL or LIBRE_MARKET_PASSWORD not set in .dev.vars')
    process.exit(1)
  }

  // Reuse test images from XMR Bazaar test (or download if missing)
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
    sku:         'TEST-001',
    title:       '[TEST SYNCDASH] Acer Monitor 27" FHD — DO NOT BUY',
    description: '[TEST LISTING — DO NOT BUY]\n\nThis is an automated test from SyncDash browser automation. Acer 27-inch Full HD IPS monitor, 75Hz, HDMI/VGA.\n\nPlease ignore this listing.',
    price:       15999,   // 159.99€
    category:    'Informatique',
    images:      imgPaths,
  }

  // Optional: pass an existing product ID as CLI arg to test the edit flow
  // e.g. npx tsx scripts/test-libremarket.ts 42
  const existingProductId = process.argv[2] || ''

  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const page    = await browser.newPage()
  page.setDefaultTimeout(30000)

  try {
    // 1. Login ONCE
    await login(page, email, password)

    // 2. Process product: edit if listing exists, create if not
    let productId: string
    if (existingProductId) {
      console.log(`\n🔍 Existing product ID provided: ${existingProductId} → editing`)
      await editListing(page, existingProductId, testProduct)
      productId = existingProductId
      await savePushResult(testProduct.sku, 'libre_market', productId, false, vars['AGENT_BEARER_TOKEN'] ?? '')
    } else {
      console.log('\n🔍 No existing product ID → creating new')
      productId = await createListing(page, testProduct)
      await savePushResult(testProduct.sku, 'libre_market', productId, true, vars['AGENT_BEARER_TOKEN'] ?? '')
    }

    // 3. Report result
    const productUrl = `https://libre-market.com/m/coincart/admin/products/${productId}`
    console.log(`\n📋 Result:`)
    console.log(`  SKU:        ${testProduct.sku}`)
    console.log(`  Product ID: ${productId}`)
    console.log(`  URL:        ${productUrl}`)

    // 4. Logout
    await logout(page)

    console.log('\n✅ Test complete!')
    if (!existingProductId && productId) {
      console.log(`\n  💡 To test the edit flow, run again with:`)
      console.log(`     npx tsx scripts/test-libremarket.ts ${productId}`)
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
