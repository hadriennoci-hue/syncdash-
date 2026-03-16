/**
 * dump-acer-specs.ts
 *
 * One-shot helper: visits an Acer Store product page and prints all raw
 * spec labels + values to the console. Use this to discover exact label
 * strings before adding them to the language maps.
 *
 * Usage:
 *   npx tsx scripts/dump-acer-specs.ts <product-url>
 *   npx tsx scripts/dump-acer-specs.ts https://store.acer.com/de-de/some-monitor
 *   npx tsx scripts/dump-acer-specs.ts https://store.acer.com/fr-fr/some-ecran
 */

import { chromium } from 'playwright'

const url = process.argv[2]
if (!url) {
  console.error('Usage: npx tsx scripts/dump-acer-specs.ts <product-url>')
  process.exit(1)
}

;(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-web-security',
    ],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-GB',
    extraHTTPHeaders: {
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  })
  // Remove navigator.webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  const page = await context.newPage()

  console.log(`\nFetching: ${url}\n`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(4000)

  // Dismiss cookie banner if present
  try {
    const cookieBtn = await page.$('#onetrust-accept-btn-handler, .accept-cookies, [id*="accept"], [class*="cookie"] button')
    if (cookieBtn) { await cookieBtn.click(); await page.waitForTimeout(1000) }
  } catch { /* ignore */ }

  // Force-dismiss any overlays/modals (cookie banners, geo redirects)
  await page.evaluate(() => {
    // Remove modal overlays
    document.querySelectorAll('.modals-overlay, .modal-overlay, .overlay, [class*="overlay"]').forEach(el => {
      (el as HTMLElement).style.display = 'none'
    })
    // Remove modal wrappers that intercept clicks
    document.querySelectorAll('.modals-wrapper, .modal-wrapper').forEach(el => {
      (el as HTMLElement).style.pointerEvents = 'none'
      ;(el as HTMLElement).style.display = 'none'
    })
    // Hide cookie banners
    document.querySelectorAll('[id*="onetrust"], [class*="cookie"], [class*="gdpr"]').forEach(el => {
      (el as HTMLElement).style.display = 'none'
    })
  })
  await page.waitForTimeout(500)

  // Scroll slowly to trigger lazy loading
  for (let i = 1; i <= 5; i++) {
    await page.evaluate((frac: number) => window.scrollTo(0, document.body.scrollHeight * frac), i / 5)
    await page.waitForTimeout(800)
  }
  await page.waitForTimeout(1000)

  // Try clicking on Specifications tab if present (use force to bypass overlay)
  try {
    const allLinks = await page.$$('a, button, [role="tab"], [data-role="trigger"], li.item.title')
    for (const el of allLinks) {
      const text = await el.textContent()
      if (text && /spec/i.test(text.trim())) {
        await el.click({ force: true })
        await page.waitForTimeout(2000)
        console.log(`Clicked element with text: "${text.trim()}"`)
        break
      }
    }
  } catch (e) { console.log('Tab click failed:', e) }

  const specs = await page.evaluate(() => {
    const out: Array<{ label: string; value: string; source: string }> = []

    // Pattern 1: table rows — Magento 2 additional-attributes
    document.querySelectorAll('.additional-attributes tr, table.data.table tr, .product-specifications tr').forEach(row => {
      const label = row.querySelector('th, .label, td:first-child')?.textContent?.trim()
      const value = row.querySelector('td, .data, td:last-child')?.textContent?.trim()
      if (label && value && label !== value) out.push({ label, value, source: 'table' })
    })

    // Pattern 2: dl/dt/dd — any dt on page
    document.querySelectorAll('dt').forEach(dt => {
      const dd = dt.nextElementSibling
      if (dd?.tagName === 'DD') {
        const label = dt.textContent?.trim()
        const value = dd.textContent?.trim()
        if (label && value) out.push({ label, value, source: 'dl' })
      }
    })

    // Pattern 3: .product.attribute divs
    document.querySelectorAll('.product.attribute').forEach(el => {
      const label = el.querySelector('.type')?.textContent?.trim()
      const value = el.querySelector('.value')?.textContent?.trim()
      if (label && value) out.push({ label, value, source: 'attr-div' })
    })

    // Pattern 4: Acer-specific spec rows (key/value pairs in spec section)
    document.querySelectorAll('.spec-row, .spec-item, .specification-row, [class*="spec"] li').forEach(el => {
      const children = Array.from(el.children)
      if (children.length >= 2) {
        const label = children[0].textContent?.trim()
        const value = children[1].textContent?.trim()
        if (label && value) out.push({ label, value, source: 'spec-row' })
      }
    })

    // Pattern 5: any table on the page with 2 columns (th/td or td/td)
    document.querySelectorAll('table tr').forEach(row => {
      const cells = row.querySelectorAll('td, th')
      if (cells.length === 2) {
        const label = cells[0].textContent?.trim()
        const value = cells[1].textContent?.trim()
        if (label && value && label !== value && label.length < 80) {
          out.push({ label, value, source: 'table-generic' })
        }
      }
    })

    return out
  })

  if (specs.length === 0) {
    // Debug: search for spec-like elements by looking at all text content with colons or table-like structures
    const debug = await page.evaluate(() => {
      // Dump large chunk of the product-info area HTML
      const main = document.querySelector('.page-main, #maincontent, main, .product-info-main, .product.media')
      return (main?.innerHTML ?? document.body.innerHTML).slice(0, 8000)
    })
    // Also check for "not available" / 404-style messages
    const notAvailable = await page.evaluate(() => {
      const body = document.body.textContent ?? ''
      return body.includes('no longer available') || body.includes('not available') || body.includes('404') || body.includes('Page Not Found')
        ? 'PRODUCT NOT AVAILABLE / 404'
        : 'Page loaded but specs section not found'
    })
    // If it's a category page, extract first product URL
    const firstProductUrl = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('li.item.product.product-item .product-item-name a')
      return link ? link.href : null
    })
    if (firstProductUrl) console.log(`First product URL on page: ${firstProductUrl}`)
    console.log(`⚠️  No specs found — ${notAvailable}`)
    if (Array.isArray(debug)) { debug.forEach((l: string) => console.log(l)) } else { console.log(debug) }
  } else {
    console.log(`Found ${specs.length} spec entries:\n`)
    const maxLabel = Math.max(...specs.map(s => s.label.length))
    for (const s of specs) {
      console.log(`  [${s.source}]  ${s.label.padEnd(maxLabel)}  →  ${s.value}`)
    }
  }

  await browser.close()
})()
