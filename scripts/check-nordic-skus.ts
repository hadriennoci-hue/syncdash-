/**
 * Try to find correct da-dk laptop URL and compare da-dk vs no-no SKUs.
 */

import { chromium } from 'playwright'

async function fetchSkus(page: import('playwright').Page, locale: string, url: string): Promise<string[]> {
  console.log(`  Trying ${locale}: ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(5000)
  try { const b = await page.$('#onetrust-accept-btn-handler'); if (b) { await b.click(); await page.waitForTimeout(1000) } } catch { /**/ }
  for (let i = 1; i <= 4; i++) { await page.evaluate((f: number) => window.scrollTo(0, document.body.scrollHeight * f), i / 4); await page.waitForTimeout(700) }

  const { skus, snippet } = await page.evaluate(() => {
    const re = /\b([A-Z]{2}\.[A-Z0-9]{4,7}\.[0-9]{3})\b/g
    const seen = new Set<string>()
    const body = document.body.innerText
    let m
    while ((m = re.exec(body)) !== null) seen.add(m[1])
    return { skus: [...seen], snippet: body.slice(0, 300).replace(/\s+/g, ' ') }
  })

  console.log(`    → ${skus.length} SKUs  snippet: "${snippet.slice(0,150)}"`)
  return skus
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' })
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  const page = await ctx.newPage()

  // Try multiple da-dk URLs
  const daCandidates = [
    'https://store.acer.com/da-dk/baerbar-computer',
    'https://store.acer.com/da-dk/baerbar-pc',
    'https://store.acer.com/da-dk/laptops',
    'https://store.acer.com/da-dk/baerbare-computere',
  ]

  let daSkus: string[] = []
  let daUrl = ''
  for (const url of daCandidates) {
    const skus = await fetchSkus(page, 'da-dk', url)
    if (skus.length > 0) { daSkus = skus; daUrl = url; break }
  }
  console.log(daSkus.length > 0 ? `\n✓ da-dk works at: ${daUrl}` : '\n✗ da-dk: no URL worked')

  // no-no with corrected URL
  const noSkus = await fetchSkus(page, 'no-no', 'https://store.acer.com/no-no/baerbar-pc')
  console.log(`no-no: ${noSkus.length} SKUs`)

  // Compare da-dk vs no-no
  if (daSkus.length && noSkus.length) {
    const sno = new Set(noSkus)
    const shared = daSkus.filter(k => sno.has(k))
    console.log(`\nda-dk vs no-no: ${shared.length}/${daSkus.length} shared (${Math.round(shared.length/daSkus.length*100)}%)`)
    if (shared.length) console.log('Shared:', shared.join(', '))
  }

  // Compare with sv-se
  const svSkus = await fetchSkus(page, 'sv-se', 'https://store.acer.com/sv-se/barbara-datorer')
  const ssv = new Set(svSkus)
  if (daSkus.length) {
    const shared = daSkus.filter(k => ssv.has(k))
    console.log(`da-dk vs sv-se: ${shared.length}/${daSkus.length} shared`)
  }
  if (noSkus.length) {
    const shared = noSkus.filter(k => ssv.has(k))
    console.log(`no-no vs sv-se: ${shared.length}/${noSkus.length} shared`)
  }

  await browser.close()
})()
