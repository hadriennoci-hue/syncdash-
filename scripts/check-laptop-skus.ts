/**
 * Quick SKU comparison across Acer laptop stores.
 * Fetches first page of each store's laptop category and extracts SKU + name.
 * Used to detect shared SKUs between locales (= same keyboard layout).
 *
 * Usage: npx tsx scripts/check-laptop-skus.ts
 */

import { chromium } from 'playwright'

const STORES: { locale: string; url: string }[] = [
  { locale: 'en-ie', url: 'https://store.acer.com/en-ie/laptops' },
  { locale: 'fr-fr', url: 'https://store.acer.com/fr-fr/ordinateurs-portables' },
  { locale: 'fr-be', url: 'https://store.acer.com/fr-be/ordinateurs-portables' },
  { locale: 'de-de', url: 'https://store.acer.com/de-de/laptops' },
  { locale: 'nl-nl', url: 'https://store.acer.com/nl-nl/laptops' },
  { locale: 'nl-be', url: 'https://store.acer.com/nl-be/laptops' },
  { locale: 'es-es', url: 'https://store.acer.com/es-es/ordenadores-portatiles' },
  { locale: 'it-it', url: 'https://store.acer.com/it-it/laptop' },
  { locale: 'pl-pl', url: 'https://store.acer.com/pl-pl/laptopy' },
  { locale: 'da-dk', url: 'https://store.acer.com/da-dk/baerbare-computere' },
  { locale: 'sv-se', url: 'https://store.acer.com/sv-se/barbara-datorer' },
  { locale: 'no-no', url: 'https://store.acer.com/no-no/baebare-pc' },
  { locale: 'fi-fi', url: 'https://store.acer.com/fi-fi/kannettavat' },
]

async function fetchSkus(page: import('playwright').Page, locale: string, url: string): Promise<Map<string, string>> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)
    const skus = await page.evaluate(() => {
      const results: Array<{ sku: string; name: string }> = []
      document.querySelectorAll('li.item.product.product-item').forEach(item => {
        const name = item.querySelector('.product-item-name')?.textContent?.trim() ?? ''
        // Acer SKU is in the "Ref." text
        const ref = item.querySelector('.product-sku, [class*="sku"], .ref-sku')?.textContent?.trim()
          ?? [...item.querySelectorAll('*')].find(el => el.textContent?.includes('Ref.'))?.textContent?.trim()
          ?? ''
        const skuMatch = ref.match(/[A-Z]{2}\.[A-Z0-9]{5,8}\.[0-9]{3}/)
        if (skuMatch) results.push({ sku: skuMatch[0], name })
      })
      return results
    })
    const map = new Map<string, string>()
    skus.forEach(({ sku, name }) => map.set(sku, name))
    console.log(`  ${locale}: ${map.size} SKUs`)
    return map
  } catch (e) {
    console.log(`  ${locale}: ERROR — ${e}`)
    return new Map()
  }
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  })
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  const page = await context.newPage()

  console.log('\nFetching SKU lists...')
  const storeMaps: Record<string, Map<string, string>> = {}
  for (const { locale, url } of STORES) {
    storeMaps[locale] = await fetchSkus(page, locale, url)
  }
  await browser.close()

  // --- Build overlap matrix ---
  const locales = Object.keys(storeMaps)
  const allSkus = new Set<string>()
  for (const m of Object.values(storeMaps)) m.forEach((_, k) => allSkus.add(k))

  console.log(`\n=== TOTAL UNIQUE SKUs ACROSS ALL STORES: ${allSkus.size} ===\n`)

  // Find SKUs shared between specific pairs
  const pairs: Array<[string, string, string]> = [
    ['fr-fr', 'fr-be', 'FR vs BE(fr)'],
    ['nl-nl', 'nl-be', 'NL vs BE(nl)'],
    ['fr-be', 'nl-be', 'BE(fr) vs BE(nl)'],
    ['da-dk', 'sv-se', 'DK vs SE'],
    ['da-dk', 'no-no', 'DK vs NO'],
    ['da-dk', 'fi-fi', 'DK vs FI'],
    ['sv-se', 'no-no', 'SE vs NO'],
    ['sv-se', 'fi-fi', 'SE vs FI'],
    ['no-no', 'fi-fi', 'NO vs FI'],
  ]

  console.log('=== PAIRWISE OVERLAP ===')
  for (const [a, b, label] of pairs) {
    const ma = storeMaps[a], mb = storeMaps[b]
    if (!ma || !mb) continue
    const shared = [...ma.keys()].filter(k => mb.has(k))
    const pctA = ma.size ? Math.round(shared.length / ma.size * 100) : 0
    const pctB = mb.size ? Math.round(shared.length / mb.size * 100) : 0
    console.log(` ${label.padEnd(20)} shared: ${shared.length} / ${ma.size} (${pctA}% of ${a}) / ${mb.size} (${pctB}% of ${b})`)
  }

  // Nordic 4-way overlap
  const nordic = ['da-dk', 'sv-se', 'no-no', 'fi-fi']
  const nordicShared = [...(storeMaps['da-dk']?.keys() ?? [])].filter(k =>
    nordic.every(l => storeMaps[l]?.has(k))
  )
  console.log(` Nordic 4-way overlap:   ${nordicShared.length} SKUs shared by DK+SE+NO+FI`)
  if (nordicShared.length > 0) {
    console.log('  Examples:', nordicShared.slice(0, 3).map(k => `${k} (${storeMaps['da-dk']?.get(k)?.slice(0,40)})`).join(', '))
  }

  // per-locale unique SKUs (not in any other store)
  console.log('\n=== LOCALE-EXCLUSIVE SKUs (unique keyboard layout indicator) ===')
  for (const locale of locales) {
    const others = new Set<string>()
    for (const [l, m] of Object.entries(storeMaps)) {
      if (l !== locale) m.forEach((_, k) => others.add(k))
    }
    const exclusive = [...(storeMaps[locale]?.keys() ?? [])].filter(k => !others.has(k))
    console.log(` ${locale.padEnd(6)}: ${exclusive.length} exclusive SKUs out of ${storeMaps[locale]?.size}`)
  }
})()
