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
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  console.log(`\nFetching: ${url}\n`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const specs = await page.evaluate(() => {
    const out: Array<{ label: string; value: string; source: string }> = []

    // Pattern 1: table rows
    document.querySelectorAll('.additional-attributes tr, table.data.table tr').forEach(row => {
      const label = row.querySelector('th, .label')?.textContent?.trim()
      const value = row.querySelector('td, .data')?.textContent?.trim()
      if (label && value) out.push({ label, value, source: 'table' })
    })

    // Pattern 2: dl/dt/dd
    document.querySelectorAll('.product-specs dt, .specifications dt, .spec-list dt').forEach(dt => {
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

    return out
  })

  if (specs.length === 0) {
    console.log('⚠️  No specs found — page may not have loaded correctly or selectors need updating.')
  } else {
    console.log(`Found ${specs.length} spec entries:\n`)
    const maxLabel = Math.max(...specs.map(s => s.label.length))
    for (const s of specs) {
      console.log(`  [${s.source}]  ${s.label.padEnd(maxLabel)}  →  ${s.value}`)
    }
  }

  await browser.close()
})()
