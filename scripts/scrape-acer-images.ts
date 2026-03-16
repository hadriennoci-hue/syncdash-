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
  productId:      string
  sourceUrl:      string | null
  sourceName:     string | null
  quantity:       number | null
  status:         string | null
  pendingReview:  number
  hasDescription: boolean
  imageCount:     number
  attributeCount: number
  categoryCount:  number
}

async function getAcerStockRows(): Promise<StockRow[]> {
  const res = await fetch(`${BASE_URL}/api/warehouses/acer_store/stock?withProduct=1`, {
    headers: { Authorization: `Bearer ${TOKEN}`, ...getAccessHeaders() },
  })
  if (!res.ok) throw new Error(`Failed to fetch acer_store stock: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data: { stock: StockRow[] } }
  return json.data?.stock ?? []
}

// ---------------------------------------------------------------------------
// Shopify TikTok collection map  (fetched once at startup)
// Maps our internal category key → Wizhard category ID.
// Auto-matched by collection name/slug — monitor and laptops keywords.
// ---------------------------------------------------------------------------

type InternalCategory = ProductCategory

let tiktokCollectionMap = new Map<InternalCategory, string>()

// Keywords to auto-match each internal category to a Shopify TikTok collection name/slug
const COLLECTION_MATCH_RULES: Array<{ cat: InternalCategory; keywords: string[] }> = [
  { cat: 'monitor',      keywords: ['monitor', 'display', 'screen', 'écran', 'scherm', 'bildschirm'] },
  { cat: 'laptops',      keywords: ['laptop', 'notebook', 'portable', 'ordinateur'] },
  { cat: 'tablets',      keywords: ['tablet', 'tablette'] },
  { cat: 'desktops',     keywords: ['desktop', 'bureau', 'torre', 'veriton'] },
  { cat: 'audio',        keywords: ['audio', 'headset', 'headphone', 'casque', 'speaker'] },
  { cat: 'gpu',          keywords: ['gpu', 'graphic', 'carte graphique'] },
  { cat: 'input-device', keywords: ['input', 'mouse', 'keyboard', 'souris', 'clavier'] },
  { cat: 'cases',        keywords: ['case', 'bag', 'sleeve', 'housse', 'tasche'] },
  { cat: 'lifestyle',    keywords: ['lifestyle'] },
]

async function fetchTiktokCollectionMap(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/categories?platform=shopify_tiktok`, {
      headers: { Authorization: `Bearer ${TOKEN}`, ...getAccessHeaders() },
    })
    if (!res.ok) { log(`⚠️  Could not fetch shopify_tiktok collections: ${res.status}`); return }
    const json = await res.json() as { data: Array<{ id: string; name: string; slug: string | null }> }
    const cols  = json.data ?? []

    for (const col of cols) {
      const key = ((col.slug ?? col.name) ?? '').toLowerCase()
      for (const { cat, keywords } of COLLECTION_MATCH_RULES) {
        if (!tiktokCollectionMap.has(cat) && keywords.some(kw => key.includes(kw))) {
          tiktokCollectionMap.set(cat, col.id)
          log(`  🏷️  ${cat} → collection "${col.name}" (${col.id})`)
          break
        }
      }
    }

    if (tiktokCollectionMap.size === 0) log(`  ⚠️  No shopify_tiktok collections matched — products will need manual collection assignment`)
  } catch (err) {
    log(`⚠️  fetchTiktokCollectionMap failed: ${err instanceof Error ? err.message : err}`)
  }
}

// ---------------------------------------------------------------------------
// Fill eligibility helpers
// ---------------------------------------------------------------------------

/** Needs a browser page visit to get description / images / attributes. */
function needsBrowserFill(row: StockRow): boolean {
  if (!row.pendingReview) return false
  if (row.imageCount === 0) return true
  // Descriptions are already saved during stock scan (step 1) — no browser visit needed for them
  // Only scan attributes for categories that have label maps
  const cat = detectCategory(row.sourceName ?? '', row.sourceUrl ?? '')
  if (ATTRIBUTE_SCAN_CATEGORIES.has(cat) && row.attributeCount === 0) return true
  return false
}

/** Has all browser data but still missing a shopify_tiktok collection. No page visit needed. */
function needsCollectionOnly(row: StockRow): boolean {
  if (!row.pendingReview) return false
  if (needsBrowserFill(row)) return false // will get collection assigned during browser fill
  return row.categoryCount === 0 // detectCategory always returns something now (lifestyle as default)
}

function needsFilling(row: StockRow): boolean {
  return needsBrowserFill(row) || needsCollectionOnly(row)
}

/** Assign a shopify_tiktok collection to a product (D1 only, no platform push). */
async function assignCollection(sku: string, category: InternalCategory): Promise<void> {
  const collectionId = tiktokCollectionMap.get(category)
  if (!collectionId) {
    log(`  ⚠️  [no-collection] "${category}" has no mapped shopify_tiktok collection — assign manually`)
    return
  }
  await uploadProductInfo(sku, { categoryIds: [collectionId] })
  log(`  🏷️  Collection assigned: ${category}`)
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
    form.append('files', new Blob([new Uint8Array(f.buffer)], { type: f.mimeType }), f.filename)
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
  const json = await res.json() as { data: { urls: string[]; errors: string[] } }
  return json.data
}

// ---------------------------------------------------------------------------
// en-ie URL construction
// Maps any locale category slug back to the en-ie equivalent so we can
// always try the English store first for description, images, and specs.
// ---------------------------------------------------------------------------

const TO_EN_IE_CAT: Record<string, string> = {
  // monitors
  'monitors': 'monitors', 'monitor': 'monitors',
  'ecrans': 'monitors', 'monitore': 'monitors', 'monitoren': 'monitors',
  'monitores': 'monitors', 'monitory': 'monitors', 'skaerme': 'monitors',
  'bildskarmar': 'monitors', 'skjermer': 'monitors', 'naytot': 'monitors',
  // laptops
  'laptops': 'laptops', 'laptop': 'laptops', 'notebook': 'laptops',
  'ordinateurs-portables': 'laptops', 'ordenadores-portatiles': 'laptops', 'portatiles': 'laptops',
  'laptopy': 'laptops', 'baerbare-computere': 'laptops',
  'barbara-datorer': 'laptops', 'baerbar-pc': 'laptops', 'kannettavat': 'laptops',
  // desktops / peripherals / accessories / gaming (for future categories)
  'desktops': 'desktops', 'desktop': 'desktops',
  'ordinateurs-de-bureau': 'desktops', 'ordenadores-sobremesa': 'desktops',
  'peripherals': 'peripherals', 'peripheriques': 'peripherals',
  'periferiche': 'peripherals', 'urzadzenia-peryferyjne': 'peripherals',
  'randapparatuur': 'peripherals', 'periferiudstyr': 'peripherals',
  'kringutrustning': 'peripherals', 'periferiutstyr': 'peripherals',
  'oheislaitteet': 'peripherals',
  'accessories': 'accessories', 'accessoires': 'accessories',
  'accessori': 'accessories', 'akcesoria': 'accessories',
  'zubehoer': 'accessories', 'tillbehoer': 'accessories',
  'tilbehoer': 'accessories', 'lisavarusteet': 'accessories',
  'gaming': 'gaming', 'pelaaminen': 'gaming',
}

// Locale-specific color/suffix words to strip when constructing en-ie slug from 2-segment URLs
const LOCALE_SLUG_SUFFIXES = ['-zwart', '-schwarz', '-noir', '-negro', '-czarny', '-sort', '-svart', '-musta']

/** Rewrite any Acer store product URL to its en-ie equivalent, or return null. */
function tryConstructEnglishUrl(sourceUrl: string): string | null {
  // 3-segment URL: store.acer.com/locale/category/product-slug
  const m3 = sourceUrl.match(/^(https:\/\/store\.acer\.com\/)([a-z]{2}-[a-z]{2})\/([^/?#]+)\/(.+)$/)
  if (m3) {
    if (m3[2] === 'en-ie') return sourceUrl // already English
    const enCat = TO_EN_IE_CAT[m3[3]]
    if (!enCat) return null
    return `${m3[1]}en-ie/${enCat}/${m3[4]}`
  }

  // 2-segment URL: store.acer.com/locale/product-slug (e.g. nl-be store)
  const m2 = sourceUrl.match(/^(https:\/\/store\.acer\.com\/)([a-z]{2}-[a-z]{2})\/([^/?#]+)$/)
  if (m2) {
    if (m2[2] === 'en-ie') return sourceUrl
    let slug = m2[3]
    // Strip locale-specific color suffixes so the slug matches en-ie
    for (const suffix of LOCALE_SLUG_SUFFIXES) {
      if (slug.endsWith(suffix)) { slug = slug.slice(0, -suffix.length); break }
    }
    // Infer en-ie category from keywords in the slug
    let enCat: string | null = null
    if (/laptop|notebook/.test(slug))               enCat = 'laptops'
    else if (/monitor|display|screen/.test(slug))   enCat = 'monitors'
    if (!enCat) return null
    return `${m2[1]}en-ie/${enCat}/${slug}`
  }

  return null
}

// ---------------------------------------------------------------------------
// Category detection
// ---------------------------------------------------------------------------

type ProductCategory = 'monitor' | 'laptops' | 'tablets' | 'desktops' | 'audio' | 'gpu' | 'input-device' | 'cases' | 'lifestyle'

/** Categories for which we have attribute label maps and should scan spec tables. */
const ATTRIBUTE_SCAN_CATEGORIES = new Set<ProductCategory>(['monitor', 'laptops'])

function detectCategory(sourceName: string, sourceUrl: string): ProductCategory {
  const n = sourceName.toLowerCase()
  const u = sourceUrl.toLowerCase()

  // --- Monitor ---
  if (u.includes('ecran')         // FR: /ecrans
   || u.includes('monitore')      // DE: /monitore, NL: /monitoren, ES: /monitores, PL: /monitory
   || u.includes('monitor')       // EN: /monitors, IT: /monitor, DA/SV/NO: /monitorer
   || u.includes('skærm')         // DA: /skærme
   || u.includes('sk%c3%a6rm')    // DA URL-encoded
   || u.includes('skärm')         // SV: /skärmar
   || u.includes('sk%c3%a4rm')    // SV URL-encoded
   || u.includes('skjerm')        // NO: /skjermer
   || u.includes('schermi')       // IT: /schermi
   || u.includes('n%c3%a4yt')     // FI URL-encoded
   || u.includes('näyt')          // FI: /näytöt
  ) return 'monitor'
  if (n.includes('écran') || n.includes('ecran') || n.includes('monitor')
   || n.includes('scherm') || n.includes('skærm') || n.includes('skärm')
   || n.includes('skjerm') || n.includes('schermo') || n.includes('näyttö')
  ) return 'monitor'

  // --- Laptop ---
  if (u.includes('laptop') || u.includes('notebook') || u.includes('ordinateur-portable')
   || u.includes('portables') || u.includes('ordenadores-portatiles')
   || u.includes('barbar')        // SV: bärbara datorer
   || u.includes('baerbar')       // NO/DK: bærbar-pc / bærbare-computere
   || u.includes('b%c3%a4rbar') || u.includes('b%c3%a6rbar')
   || u.includes('kannettav')     // FI: kannettavat
   || u.includes('/portatil')     // ES: /portatiles
   || u.includes('/notebook')     // IT: /notebook
  ) return 'laptops'
  if (n.includes('ordinateur') || n.includes('portable') || n.includes('laptop')
   || n.includes('notebook') || n.includes('portátil') || n.includes('kannettava')
  ) return 'laptops'

  // --- Tablet ---
  if (u.includes('tablet') || u.includes('tablette') || u.includes('tabletas')
   || u.includes('tabletti')      // FI
  ) return 'tablets'
  if (n.includes('tablet') || n.includes('tablette') || n.includes('tableta')
   || n.includes(' tab ')         // "Acer Tab X ..."
  ) return 'tablets'

  // --- Desktop ---
  if (u.includes('desktop') || u.includes('ordinateur-de-bureau')
   || u.includes('ordenadores-sobremesa') || u.includes('desktop-computer')
  ) return 'desktops'
  if (n.includes('desktop') || n.includes('all-in-one') || n.includes('allinone')
   || n.includes('veriton') || n.includes('aspire tc') || n.includes('aspire xc')
   || n.includes('bureau') || n.includes('torre')
  ) return 'desktops'

  // --- Audio ---
  if (u.includes('/audio') || u.includes('/casques') || u.includes('/kopfhoer')
   || u.includes('/headset') || u.includes('/headphone')
  ) return 'audio'
  if (n.includes('headset') || n.includes('headphone') || n.includes('earphone')
   || n.includes('speaker') || n.includes('casque') || n.includes('kopfhörer')
   || n.includes('écouteur') || n.includes('enceinte')
  ) return 'audio'

  // --- GPU ---
  if (u.includes('/gpu') || u.includes('/graphics') || u.includes('/carte-graphique')
   || u.includes('/grafik')
  ) return 'gpu'
  if (n.includes(' gpu') || n.includes('graphics card') || n.includes('carte graphique')
   || n.includes('grafikkarte')
  ) return 'gpu'

  // --- Input device ---
  if (u.includes('/mice') || u.includes('/keyboards') || u.includes('/souris')
   || u.includes('/claviers') || u.includes('/maus') || u.includes('/tastatur')
   || u.includes('/muizen') || u.includes('/toetsenbord')
  ) return 'input-device'
  if (n.includes('mouse') || n.includes('mice') || n.includes('keyboard')
   || n.includes('souris') || n.includes('clavier') || n.includes('maus')
   || n.includes('tastatur') || n.includes('muis') || n.includes('toetsenbord')
  ) return 'input-device'

  // --- Cases / bags ---
  if (u.includes('/cases') || u.includes('/bags') || u.includes('/housse')
   || u.includes('/tasche') || u.includes('/sac')
  ) return 'cases'
  if (n.includes('case') || n.includes('sleeve') || n.includes('backpack')
   || n.includes('bag') || n.includes('housse') || n.includes('sacoche')
   || n.includes('tasche') || n.includes('rucksack')
  ) return 'cases'

  // --- Default: lifestyle ---
  return 'lifestyle'
}

// ---------------------------------------------------------------------------
// Locale detection from source URL
// store.acer.com/fr-fr/… → 'fr'   store.acer.com/de-de/… → 'de'
// ---------------------------------------------------------------------------

function detectLocale(sourceUrl: string): string | null {
  const m = sourceUrl.match(/store\.acer\.com\/([a-z]{2})-[a-z]{2}\//)
  return m ? m[1] : null
}

function detectFullLocale(sourceUrl: string): string | null {
  const m = sourceUrl.match(/store\.acer\.com\/([a-z]{2}-[a-z]{2})\//)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Keyboard layout detection — laptops only
// Derived from the stored source URL locale (which reflects the store where
// the product was found, i.e. its keyboard variant).
//
// Research (2026-03): confirmed by pairwise SKU comparison across 13 stores.
//   • fr-be and nl-be share 100% of SKUs → same Belgian AZERTY keyboard
//   • sv-se, fi-fi and no-no share 100% of SKUs → same Nordic keyboard
//   • Acer uses "ED" SKU suffix for Nordic products (multi-country variant)
// ---------------------------------------------------------------------------
const KEYBOARD_LAYOUT_BY_LOCALE: Record<string, string> = {
  'en-ie': 'uk_qwerty',
  'fr-fr': 'fr_azerty',
  'fr-be': 'be_azerty',
  'nl-be': 'be_azerty',   // same products as fr-be
  'de-de': 'de_qwertz',
  'es-es': 'es_qwerty',
  'it-it': 'it_qwerty',
  'pl-pl': 'pl_qwerty',
  'nl-nl': 'nl_qwerty',
  'sv-se': 'nordic',       // sv-se = fi-fi = no-no (confirmed 100% SKU overlap)
  'fi-fi': 'nordic',
  'no-no': 'nordic',
  'da-dk': 'nordic',       // assumed same Nordic variant (AJAX-rendered, unverifiable by scraping)
}

function detectKeyboardLayout(sourceUrl: string): string | null {
  const locale = detectFullLocale(sourceUrl)
  return locale ? (KEYBOARD_LAYOUT_BY_LOCALE[locale] ?? null) : null
}

// ---------------------------------------------------------------------------
// Attribute label → key maps  (one block per language, same attribute keys)
// To add a new language: copy a block, change the labels, add the locale key.
// Run: npm run scrape:acer:dump -- <product-url>  to discover exact labels.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Locale-aware label maps
// Keys are lowercase label text as it appears on the store's spec tab.
// Values are canonical English attribute keys stored in Wizhard.
//
// To add a new language or verify labels:
//   npm run scrape:acer:dump -- https://store.acer.com/<locale>/<product-slug>
//
// Verified locales are marked [✓]. Others are best-guess — run dump to confirm.
// ---------------------------------------------------------------------------

const MONITOR_LABEL_MAPS: Record<string, Record<string, string>> = {
  en: { // [✓] en-ie — English (Ireland)
    'screen size':                   'screen_size',
    'display size':                  'screen_size',
    'maximum resolution':            'resolution',
    'native resolution':             'resolution',
    'panel technology':              'panel_type',
    'refresh rate':                  'refresh_rate',
    'response time':                 'response_time',
    'aspect ratio':                  'aspect_ratio',
    'brightness':                    'brightness',
    'sync technology':               'gsync_freesync',
    'adaptive sync':                 'gsync_freesync',
    'vesa mount standard':           'vesa_mount',
    'colour':                        'color',
    'color':                         'color',
    'curved':                        'curved',
    'hdr':                           'hdr',
    'color gamut':                   'color_gamut',
    'colour gamut':                  'color_gamut',
  },
  fr: { // [✓] fr-fr / fr-be — French
    "taille de l'écran":             'screen_size',
    "taille d'écran":                'screen_size',
    'diagonale':                     'screen_size',
    'résolution':                    'resolution',
    'résolution native':             'resolution',
    'type de panneau':               'panel_type',
    'technologie de panneau':        'panel_type',
    'fréquence de rafraîchissement': 'refresh_rate',
    'taux de rafraîchissement':      'refresh_rate',
    'temps de réponse':              'response_time',
    "format d'image":                'aspect_ratio',
    'rapport hauteur/largeur':       'aspect_ratio',
    'courbure':                      'curved',
    'luminosité':                    'brightness',
    'luminosité (typ.)':             'brightness',
    'hdr':                           'hdr',
    'compatible g-sync':             'gsync_freesync',
    'compatible freesync':           'gsync_freesync',
    'freesync':                      'gsync_freesync',
    'synctechnologie':               'gsync_freesync',
    'gamme de couleurs':             'color_gamut',
    'espace colorimétrique':         'color_gamut',
    'vesa':                          'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'couleur':                       'color',
    'connectivité':                  'ports',
    'ports':                         'ports',
  },
  de: { // [✓] de-de — German (verified from store.acer.com/de-de)
    'bildschirmdiagonale':           'screen_size',
    'maximale auflösung':            'resolution',
    'bildschirmauflösung':           'resolution',
    'panel-technologie':             'panel_type',
    'bildwiederholungsrate':         'refresh_rate',
    'reaktionszeit':                 'response_time',
    'seitenverhältnis':              'aspect_ratio',
    'helligkeit':                    'brightness',
    'synctechnologie':               'gsync_freesync',
    'vesa mount standard':           'vesa_mount',
    'vesa-wandhalterungsnorm':       'vesa_mount',
    'farbe':                         'color',
    'curved':                        'curved',
    'hdr':                           'hdr',
    'farbumfang':                    'color_gamut',
    'farbraum':                      'color_gamut',
  },
  nl: { // [✓] nl-nl / nl-be — Dutch (verified from store.acer.com/nl-be)
    'beeldschermdiagonaal':          'screen_size',
    'schermdiagonaal':               'screen_size',
    'schermformaat':                 'screen_size',
    'maximale resolutie':            'resolution',
    'schermresolutie':               'resolution',
    'paneeltechnologie':             'panel_type',
    'verversingsfrequentie':         'refresh_rate',
    'vernieuwingssnelheid':          'refresh_rate',
    'reactietijd':                   'response_time',
    'beeldverhouding':               'aspect_ratio',
    'helderheid':                    'brightness',
    'synchronisatietechnologie':     'gsync_freesync',
    'montage vesa standaard':        'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'kleur':                         'color',
    'curved':                        'curved',
    'gebogen':                       'curved',
    'hdr':                           'hdr',
    'kleurbereik':                   'color_gamut',
    'kleurruimte':                   'color_gamut',
  },
  es: { // [✓] es-es — Spanish (verified from store.acer.com/es-es)
    'diagonal de pantalla':          'screen_size',
    'tamaño de pantalla':            'screen_size',
    'tamaño de la pantalla':         'screen_size',
    'resolución máxima':             'resolution',
    'resolución nativa':             'resolution',
    'tecnología del panel':          'panel_type',
    'frecuencia de actualización':   'refresh_rate',
    'tiempo de respuesta':           'response_time',
    'relación de aspecto':           'aspect_ratio',
    'brillo':                        'brightness',
    'tecnología de sincronización':  'gsync_freesync',
    'estándar de montaje vesa':      'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'color':                         'color',
    'curved':                        'curved',
    'curvado':                       'curved',
    'hdr':                           'hdr',
    'gama de colores':               'color_gamut',
    'espacio de color':              'color_gamut',
  },
  it: { // [✓] it-it — Italian (verified from store.acer.com/it-it)
    'diagonale schermo':             'screen_size',
    'dimensione dello schermo':      'screen_size',
    'dimensioni dello schermo':      'screen_size',
    'risoluzione massima':           'resolution',
    'risoluzione nativa':            'resolution',
    'tecnologia del pannello':       'panel_type',
    'frequenza di aggiornamento':    'refresh_rate',
    'tempo di risposta':             'response_time',
    'rapporto di aspetto':           'aspect_ratio',
    'luminosità':                    'brightness',
    'tecnologia di sincronizzazione':'gsync_freesync',
    'montaggio vesa standard':       'vesa_mount',
    'standard di montaggio vesa':    'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'colore':                        'color',
    'curved':                        'curved',
    'curvo':                         'curved',
    'hdr':                           'hdr',
    'gamut dei colori':              'color_gamut',
    'spazio colore':                 'color_gamut',
  },
  pl: { // [✓] pl-pl — Polish (verified from store.acer.com/pl-pl)
    'przekątna ekranu':              'screen_size',
    'maksymalna rozdzielczość':      'resolution',
    'technologia panelu':            'panel_type',
    'częstotliwość odświeżania':     'refresh_rate',
    'czas reakcji':                  'response_time',
    'proporcje obrazu':              'aspect_ratio',
    'jasność':                       'brightness',
    'technologia synchronizacji':    'gsync_freesync',
    'standard montażu vesa':         'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'kolor':                         'color',
    'curved':                        'curved',
    'zakrzywiony':                   'curved',
    'hdr':                           'hdr',
    'przestrzeń kolorów':            'color_gamut',
    'zakres kolorów':                'color_gamut',
  },
  da: { // [✓] da-dk — Danish (verified from store.acer.com/da-dk)
    'skærmstørrelse':                'screen_size',
    'skærmdiagonal':                 'screen_size',
    'maksimal opløsning':            'resolution',
    'panelteknologi':                'panel_type',
    'opdateringshastighed':          'refresh_rate',
    'svartid':                       'response_time',
    'responstid':                    'response_time',
    'billedformat':                  'aspect_ratio',
    'lysstyrke':                     'brightness',
    'synkroniseringsteknologi':      'gsync_freesync',
    'vesa-monteringsstandard':       'vesa_mount',
    'vesa monteringsstandard':       'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'farve':                         'color',
    'curved':                        'curved',
    'buet':                          'curved',
    'hdr':                           'hdr',
    'farveomfang':                   'color_gamut',
    'farverum':                      'color_gamut',
  },
  sv: { // [✓] sv-se — Swedish (verified from store.acer.com/sv-se)
    'bildskärmsstorlek':             'screen_size',
    'skärmstorlek':                  'screen_size',
    'skärmdiagonal':                 'screen_size',
    'maximal upplösning':            'resolution',
    'panelteknik':                   'panel_type',
    'uppdateringsfrekvens':          'refresh_rate',
    'svarstid':                      'response_time',
    'responstid':                    'response_time',
    'bildformat':                    'aspect_ratio',
    'ljusstyrka':                    'brightness',
    'synkroniseringsteknik':         'gsync_freesync',
    'vesa-monteringsstandard':       'vesa_mount',
    'vesa monteringsstandard':       'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'färg':                          'color',
    'curved':                        'curved',
    'böjd':                          'curved',
    'hdr':                           'hdr',
    'färgomfång':                    'color_gamut',
    'färgrymd':                      'color_gamut',
  },
  no: { // [✓] no-no — Norwegian (verified from store.acer.com/no-no)
    'skjermstørrelse':               'screen_size',
    'skjermdiagonal':                'screen_size',
    'maksimal oppløsning':           'resolution',
    'panelteknologi':                'panel_type',
    'oppdateringsfrekvens':          'refresh_rate',
    'responstid':                    'response_time',
    'bildeformat':                   'aspect_ratio',
    'lysstyrke':                     'brightness',
    'synkroniseringsteknologi':      'gsync_freesync',
    'vesa-monteringsstandard':       'vesa_mount',
    'vesa monteringsstandard':       'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'farge':                         'color',
    'curved':                        'curved',
    'buet':                          'curved',
    'hdr':                           'hdr',
    'fargeomfang':                   'color_gamut',
    'fargerom':                      'color_gamut',
  },
  fi: { // [✓] fi-fi — Finnish (verified from store.acer.com/fi-fi)
    'näytön koko':                   'screen_size',
    'näyttödiagonaali':              'screen_size',
    'maksimitarkkuus':               'resolution',
    'paneelitekniikka':              'panel_type',
    'pystysuuntainen taajuus':       'refresh_rate',
    'virkistystaajuus':              'refresh_rate',
    'vastausaika':                   'response_time',
    'vasteaika':                     'response_time',
    'kuvasuhde':                     'aspect_ratio',
    'kirkkaus':                      'brightness',
    'synkronointitekniikka':         'gsync_freesync',
    'standardi vesa mount':          'vesa_mount',
    'vesa-kiinnitysstandardi':       'vesa_mount',
    'vesa mount standard':           'vesa_mount',
    'väri':                          'color',
    'curved':                        'curved',
    'kaareva':                       'curved',
    'hdr':                           'hdr',
    'väriavaruus':                   'color_gamut',
    'värigamut':                     'color_gamut',
  },
}

const LAPTOP_LABEL_MAPS: Record<string, Record<string, string>> = {
  en: { // [✓] en-ie — English
    'screen size':                   'screen_size',
    'maximum resolution':            'resolution',
    'panel technology':              'panel_type',
    'processor':                     'processor_model',
    'processor model':               'processor_model',
    'processor brand':               'processor_brand',
    'processor generation':          'processor_generation',
    'number of cores':               'processor_cores',
    'refresh rate':                  'refresh_rate',
    'touchscreen':                   'touchscreen',
    'memory':                        'ram',
    'ram':                           'ram',
    'memory type':                   'ram_type',
    'maximum memory':                'ram_max',
    'storage':                       'storage',
    'storage capacity':              'storage',
    'storage type':                  'storage_type',
    'graphics':                      'graphics',
    'graphics card':                 'graphics',
    'discrete graphics':             'graphics',
    'integrated graphics':           'graphics',
    'colour':                        'color',
    'color':                         'color',
    'chassis color':                 'color',
    'case colour':                   'color',
  },
  fr: { // [✓] fr-fr / fr-be
    "taille de l'écran":             'screen_size',
    "taille d'écran":                'screen_size',
    'résolution':                    'resolution',
    'résolution native':             'resolution',
    'processeur':                    'processor_model',
    'modèle de processeur':          'processor_model',
    'marque du processeur':          'processor_brand',
    'génération du processeur':      'processor_generation',
    'nombre de coeurs':              'processor_cores',
    'type de panneau':               'panel_type',
    "type d'écran":                  'panel_type',
    'fréquence de rafraîchissement': 'refresh_rate',
    'écran tactile':                 'touchscreen',
    'mémoire ram':                   'ram',
    'ram':                           'ram',
    'type de ram':                   'ram_type',
    'ram maximale':                  'ram_max',
    'stockage':                      'storage',
    'capacité de stockage':          'storage',
    'type de stockage':              'storage_type',
    'carte graphique':               'graphics',
    'graphique':                     'graphics',
    'graphiques':                    'graphics',
    'couleur':                       'color',
    'couleur du boîtier':            'color',
  },
  de: { // [✓] de-de — German
    'bildschirmdiagonale':           'screen_size',
    'maximale auflösung':            'resolution',
    'panel-technologie':             'panel_type',
    'prozessor':                     'processor_model',
    'prozessormodell':               'processor_model',
    'prozessormarke':                'processor_brand',
    'prozessorkerne':                'processor_cores',
    'bildwiederholungsrate':         'refresh_rate',
    'touchscreen':                   'touchscreen',
    'arbeitsspeicher':               'ram',
    'ram':                           'ram',
    'speicherkapazität':             'storage',
    'speichertyp':                   'storage_type',
    'grafik':                        'graphics',
    'grafikkarte':                   'graphics',
    'grafikprozessor':               'graphics',
    'farbe':                         'color',
    'gehäusefarbe':                  'color',
  },
  nl: { // nl-nl / nl-be [best-guess]
    'beeldschermdiagonaal':          'screen_size',
    'maximale resolutie':            'resolution',
    'paneeltechnologie':             'panel_type',
    'processor':                     'processor_model',
    'processormerk':                 'processor_brand',
    'verversingsfrequentie':         'refresh_rate',
    'touchscreen':                   'touchscreen',
    'werkgeheugen':                  'ram',
    'ram':                           'ram',
    'opslagcapaciteit':              'storage',
    'opslagtype':                    'storage_type',
    'grafische kaart':               'graphics',
    'grafisch':                      'graphics',
    'kleur':                         'color',
  },
  es: { // es-es [best-guess]
    'diagonal de pantalla':          'screen_size',
    'resolución máxima':             'resolution',
    'tecnología del panel':          'panel_type',
    'procesador':                    'processor_model',
    'marca del procesador':          'processor_brand',
    'frecuencia de actualización':   'refresh_rate',
    'pantalla táctil':               'touchscreen',
    'memoria ram':                   'ram',
    'ram':                           'ram',
    'almacenamiento':                'storage',
    'tipo de almacenamiento':        'storage_type',
    'tarjeta gráfica':               'graphics',
    'gráficos':                      'graphics',
    'color':                         'color',
    'color del chasis':              'color',
  },
  it: { // it-it [best-guess]
    'diagonale schermo':             'screen_size',
    'risoluzione massima':           'resolution',
    'tecnologia del pannello':       'panel_type',
    'processore':                    'processor_model',
    'marca del processore':          'processor_brand',
    'frequenza di aggiornamento':    'refresh_rate',
    'touchscreen':                   'touchscreen',
    'memoria ram':                   'ram',
    'ram':                           'ram',
    'memoria di archiviazione':      'storage',
    'tipo di archiviazione':         'storage_type',
    'scheda grafica':                'graphics',
    'grafica':                       'graphics',
    'colore':                        'color',
    'colore chassis':                'color',
  },
  pl: { // pl-pl [best-guess]
    'przekątna ekranu':              'screen_size',
    'maksymalna rozdzielczość':      'resolution',
    'technologia panelu':            'panel_type',
    'procesor':                      'processor_model',
    'marka procesora':               'processor_brand',
    'częstotliwość odświeżania':     'refresh_rate',
    'ekran dotykowy':                'touchscreen',
    'pamięć ram':                    'ram',
    'ram':                           'ram',
    'pojemność pamięci':             'storage',
    'typ pamięci masowej':           'storage_type',
    'karta graficzna':               'graphics',
    'grafika':                       'graphics',
    'kolor':                         'color',
    'kolor obudowy':                 'color',
  },
  da: { // da-dk [best-guess]
    'skærmstørrelse':                'screen_size',
    'maksimal opløsning':            'resolution',
    'panelteknologi':                'panel_type',
    'processor':                     'processor_model',
    'opdateringshastighed':          'refresh_rate',
    'touchskærm':                    'touchscreen',
    'hukommelse':                    'ram',
    'ram':                           'ram',
    'lagerkapacitet':                'storage',
    'lagertype':                     'storage_type',
    'grafikkort':                    'graphics',
    'grafik':                        'graphics',
    'farve':                         'color',
  },
  sv: { // sv-se [best-guess]
    'skärmstorlek':                  'screen_size',
    'maximal upplösning':            'resolution',
    'panelteknik':                   'panel_type',
    'processor':                     'processor_model',
    'uppdateringsfrekvens':          'refresh_rate',
    'pekskärm':                      'touchscreen',
    'arbetsminne':                   'ram',
    'ram':                           'ram',
    'lagringskapacitet':             'storage',
    'lagringstyp':                   'storage_type',
    'grafikkort':                    'graphics',
    'grafik':                        'graphics',
    'färg':                          'color',
  },
  no: { // no-no [best-guess]
    'skjermstørrelse':               'screen_size',
    'maksimal oppløsning':           'resolution',
    'panelteknologi':                'panel_type',
    'prosessor':                     'processor_model',
    'oppdateringsfrekvens':          'refresh_rate',
    'berøringsskjerm':               'touchscreen',
    'minne':                         'ram',
    'ram':                           'ram',
    'lagringskapasitet':             'storage',
    'lagringstype':                  'storage_type',
    'grafikkort':                    'graphics',
    'grafikk':                       'graphics',
    'farge':                         'color',
  },
  fi: { // fi-fi [best-guess]
    'näytön koko':                   'screen_size',
    'maksimitarkkuus':               'resolution',
    'paneelitekniikka':              'panel_type',
    'prosessori':                    'processor_model',
    'virkistystaajuus':              'refresh_rate',
    'kosketusnäyttö':                'touchscreen',
    'muisti':                        'ram',
    'ram':                           'ram',
    'tallennuskapasiteetti':         'storage',
    'tallennustyyppi':               'storage_type',
    'näytönohjain':                  'graphics',
    'grafiikka':                     'graphics',
    'väri':                          'color',
  },
}

function normalizeSpecValue(key: string, raw: string): string {
  // Normalise German decimal comma to dot first (e.g. "60,5" → "60.5")
  const v = raw.trim().replace(/(\d),(\d)/g, '$1.$2')
  // screen_size: extract inch number
  // handles: '27"', '27 pouces', '60.5 cm (23.8 Zoll)', '23.8"'
  if (key === 'screen_size') {
    // Prefer value in parentheses with Zoll: "(23.8 Zoll)"
    const zoll = v.match(/\((\d+(?:\.\d+)?)\s*zoll\)/i)
    if (zoll) return zoll[1]
    const m = v.match(/(\d+(?:\.\d+)?)/)
    return m ? m[1] : v
  }
  // resolution: normalise spaces e.g. "1920 x 1080" → "1920x1080"
  if (key === 'resolution' || key === 'screen_resolution') {
    return v.replace(/\s*[x×]\s*/gi, 'x')
  }
  // refresh_rate: extract number e.g. "144 Hz" → "144"
  if (key === 'refresh_rate') {
    const m = v.match(/(\d+)/)
    return m ? m[1] : v
  }
  // response_time: extract number e.g. "1 ms", "500 µs" → "1", "500"
  if (key === 'response_time') {
    const m = v.match(/(\d+(?:\.\d+)?)/)
    return m ? m[1] : v
  }
  // brightness: extract number e.g. "300 cd/m²" → "300"
  if (key === 'brightness') {
    const m = v.match(/(\d+)/)
    return m ? m[1] : v
  }
  return v
}

// Keywords that signal a label is related to one of our tracked attributes.
// Only unmapped labels containing one of these words trigger a warning.
const MONITOR_SPEC_KEYWORDS = [
  'screen', 'display', 'diagonal', 'diagonale', 'bildschirm', 'beeldscherm', 'skärm', 'scherm',
  'resolution', 'résolution', 'auflösung', 'resolutie', 'resolución', 'rozdzielczość', 'upplösning',
  'panel', 'panneau',
  'refresh', 'rafraîchissement', 'bildwiederholung', 'verversing', 'actualización', 'opdateringsfrekvens',
  'response', 'réponse', 'reaktionszeit', 'reactietijd', 'respuesta',
  'aspect', 'rapport', 'seitenverhältnis', 'beeldverhouding',
  'brightness', 'luminosité', 'helligkeit', 'helderheid', 'brillo', 'luminosidad',
  'contrast', 'contraste', 'kontrast',
  'hdr',
  'gamut', 'colorimétrique', 'kleurruimte', 'färgomfång',
  'vesa',
  'hdmi', 'displayport', 'thunderbolt',
]
const LAPTOP_SPEC_KEYWORDS = [
  'screen', 'display', 'diagonal', 'diagonale', 'bildschirm',
  'resolution', 'résolution', 'auflösung', 'resolutie',
  'panel', 'panneau',
  'refresh', 'rafraîchissement',
  'processor', 'cpu', 'prozessor', 'processeur',
  'memory', 'ram', 'mémoire', 'speicher', 'geheugen',
  'storage', 'ssd', 'hdd', 'stockage', 'speicher',
  'battery', 'batterie', 'akku',
  'gpu', 'graphics', 'graphique', 'grafik',
  'weight', 'gewicht', 'poids',
  'keyboard', 'clavier', 'tastatur',
  'webcam', 'camera',
  'thunderbolt', 'hdmi', 'usb',
  'bluetooth', 'wifi', 'wi-fi',
  'os', 'operating system', 'système d\'exploitation',
]

function isSpecRelatedLabel(label: string, category: ProductCategory): boolean {
  const keywords = category === 'monitor' ? MONITOR_SPEC_KEYWORDS : LAPTOP_SPEC_KEYWORDS
  return keywords.some(kw => label.includes(kw))
}

function mapSpecs(
  rawSpecs: Record<string, string>,
  category: ProductCategory,
  locale: string | null,
  warnUnmapped?: (label: string, value: string) => void,
): Array<{ key: string; value: string }> {
  if (!category) return []
  const maps = category === 'monitor' ? MONITOR_LABEL_MAPS : LAPTOP_LABEL_MAPS

  // Build lookup order: detected locale first, then all others as fallback
  const locales = locale && maps[locale]
    ? [locale, ...Object.keys(maps).filter(l => l !== locale)]
    : Object.keys(maps)

  const out: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  for (const [rawLabel, rawValue] of Object.entries(rawSpecs)) {
    const label = rawLabel.toLowerCase().trim()
    let attrKey: string | undefined
    for (const loc of locales) {
      attrKey = maps[loc]?.[label]
      if (attrKey) break
    }
    if (!attrKey) {
      // Only warn if the label looks like it belongs to one of our tracked attributes
      // (i.e. it might be a new synonym we should add to the map)
      if (warnUnmapped && isSpecRelatedLabel(label, category)) warnUnmapped(rawLabel, rawValue)
      continue
    }
    if (seen.has(attrKey)) continue
    const value = normalizeSpecValue(attrKey, rawValue)
    if (!value) continue
    seen.add(attrKey)
    out.push({ key: attrKey, value })
  }
  return out
}

// ---------------------------------------------------------------------------
// Acer Store DOM scraper
// ---------------------------------------------------------------------------

interface ProductPageData {
  images:      Array<{ url: string; alt: string }>
  specs:       Record<string, string>
  description: string | null
}

/** Extract images and spec table from the product page in a single visit */
async function extractProductData(
  context: BrowserContext,
  productUrl: string,
): Promise<ProductPageData> {
  const page = await context.newPage()
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1_200)

    // Click the "Caractéristiques" / "Specifications" tab if present
    const specTab = await page.$('[data-role="content"] [data-role="trigger"], .data.switch[aria-controls*="additional"], #tab-label-additional')
    if (specTab) { try { await specTab.click(); await page.waitForTimeout(400) } catch {} }

    return await page.evaluate(() => {
      // Images
      const images = Array.from(document.querySelectorAll<HTMLElement>('[data-src],[src]'))
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

      // Specs — try multiple table/dl patterns
      const specs: Record<string, string> = {}

      // Pattern 1: <table> with <th> label + <td> value
      document.querySelectorAll('.additional-attributes tr, table.data.table tr').forEach(row => {
        const label = row.querySelector('th, .label')?.textContent?.trim()
        const value = row.querySelector('td, .data')?.textContent?.trim()
        if (label && value) specs[label] = value
      })

      // Pattern 2: <dl><dt>label</dt><dd>value</dd></dl>
      if (Object.keys(specs).length === 0) {
        document.querySelectorAll('.product-specs dt, .specifications dt, .spec-list dt').forEach(dt => {
          const dd = dt.nextElementSibling
          if (dd?.tagName === 'DD') {
            const label = dt.textContent?.trim()
            const value = dd.textContent?.trim()
            if (label && value) specs[label] = value
          }
        })
      }

      // Pattern 3: .product.attribute rows
      if (Object.keys(specs).length === 0) {
        document.querySelectorAll('.product.attribute').forEach(el => {
          const label = el.querySelector('.type')?.textContent?.trim()
          const value = el.querySelector('.value')?.textContent?.trim()
          if (label && value) specs[label] = value
        })
      }

      // Description — extract as plain text (rule 3.10: no HTML to sales channels)
      // Acer Store (Magento 2): short description lives under .product.attribute.description
      // but may also contain Magento Page Builder CSS blocks — skip those.
      let description: string | null = null
      const descCandidates = Array.from(document.querySelectorAll<HTMLElement>(
        '.product.attribute.description .value p, .product.attribute.description .value, .product-attribute-description .value, .overview .value'
      ))
      for (const descEl of descCandidates) {
        // Remove style/script children before reading text
        const clone = descEl.cloneNode(true) as HTMLElement
        clone.querySelectorAll('style, script').forEach(s => s.remove())
        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
        clone.querySelectorAll('p, li, div, h1, h2, h3, h4').forEach(el => {
          el.textContent = (el.textContent ?? '') + '\n'
        })
        const raw = (clone.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
        // Reject CSS blocks (page builder injects CSS as text nodes)
        if (raw.length < 10) continue
        if (/^\s*#[a-zA-Z0-9_-]+\s*\{/.test(raw)) continue   // starts with a CSS rule
        if ((raw.match(/\{/g) ?? []).length > 3) continue     // too many braces → CSS
        description = raw
        break
      }

      return { images, specs, description }
    })
  } finally {
    await page.close()
  }
}

/** @deprecated kept for callers — wraps extractProductData */
async function extractImageUrls(
  context: BrowserContext,
  productUrl: string,
): Promise<Array<{ url: string; alt: string }>> {
  const data = await extractProductData(context, productUrl)
  return data.images
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
// Attributes upload
// ---------------------------------------------------------------------------

async function uploadAttributes(sku: string, attributes: Array<{ key: string; value: string }>): Promise<void> {
  if (attributes.length === 0) return
  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}/attributes`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...getAccessHeaders(),
    },
    body: JSON.stringify({ mode: 'merge', attributes, triggeredBy: 'agent' }),
  })
  if (!res.ok) throw new Error(`Attributes API ${res.status}: ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Product info upload — description + status (D1 only, no platform push)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tag generation — 6 tags per product derived from attributes + title
// Tags must be single words (hyphens OK, no spaces). Max 10, we use up to 6.
// Always regenerated on fill runs so they improve as attributes fill in.
// ---------------------------------------------------------------------------

function generateTags(
  category: ProductCategory,
  attrs: Array<{ key: string; value: string }>,
  title: string,
  description: string | null,
): string[] {
  const a = Object.fromEntries(attrs.map(x => [x.key, x.value.toLowerCase()]))
  const text = (title + ' ' + (description ?? '')).toLowerCase()
  const tags: string[] = []

  if (category === 'monitor') {
    // 1. Screen size bucket (inches)
    const sz = parseFloat(a['screen_size'] ?? '')
    if (!isNaN(sz)) tags.push(sz <= 22 ? '22-inch' : sz <= 24.9 ? '24-inch' : sz <= 27.9 ? '27-inch' : sz <= 31.9 ? '32-inch' : '34-inch-plus')

    // 2. Resolution label
    const res = a['resolution'] ?? ''
    if (/3840|4k|uhd/.test(res))           tags.push('4k')
    else if (/2560|1440|qhd|2k/.test(res)) tags.push('2k')
    else if (/1920|1080|fhd/.test(res))    tags.push('full-hd')

    // 3. Panel type
    const panel = a['panel_type'] ?? ''
    if (panel.includes('oled'))      tags.push('oled')
    else if (panel.includes('ips'))  tags.push('ips')
    else if (panel.includes('va'))   tags.push('va')
    else if (panel.includes('tn'))   tags.push('tn')

    // 4. Refresh rate bucket
    const hz = parseInt(a['refresh_rate'] ?? '0', 10)
    if (hz >= 240)      tags.push('240hz')
    else if (hz >= 165) tags.push('165hz')
    else if (hz >= 144) tags.push('144hz')
    else if (hz >= 100) tags.push('100hz')
    else if (hz >= 60)  tags.push('60hz')

    // 5. Use case
    if (/nitro|predator|gaming|game/.test(text))      tags.push('gaming')
    else if (/vero|eco|sustainable/.test(text))        tags.push('eco')
    else if (/design|creative|color-accurate/.test(text)) tags.push('creative')
    else if (/portable|pd193|dual-screen/.test(text)) tags.push('portable')
    else                                               tags.push('office')

    // 6. Acer series from title
    const series = title.toLowerCase().match(/\b(nitro|predator|vero|ek|sa|xv|xf|kg|qg|b7|b9|cb|prodesigner)\b/)
    if (series) {
      const m: Record<string, string> = { nitro: 'nitro', predator: 'predator', vero: 'vero', sa: 'sa-series', ek: 'ek-series', xv: 'xv-series', xf: 'xf-series', kg: 'kg-series', qg: 'qg-series' }
      tags.push(m[series[1]] ?? series[1] + '-series')
    }
  }

  if (category === 'laptops') {
    // 1. Screen size bucket
    const sz = parseFloat(a['screen_size'] ?? '')
    if (!isNaN(sz)) tags.push(sz <= 13.5 ? '13-inch' : sz <= 14.5 ? '14-inch' : sz <= 15.9 ? '15-inch' : sz <= 16.5 ? '16-inch' : '17-inch')

    // 2. Processor tier
    const cpu = a['processor_model'] ?? ''
    if (/core.{0,4}i9|ultra.{0,4}9/.test(cpu))          tags.push('intel-i9')
    else if (/core.{0,4}i7|ultra.{0,4}7/.test(cpu))     tags.push('intel-i7')
    else if (/core.{0,4}i5|ultra.{0,4}5/.test(cpu))     tags.push('intel-i5')
    else if (/core.{0,4}i3/.test(cpu))                   tags.push('intel-i3')
    else if (/ryzen.{0,4}9/.test(cpu))                   tags.push('amd-ryzen-9')
    else if (/ryzen.{0,4}7/.test(cpu))                   tags.push('amd-ryzen-7')
    else if (/ryzen.{0,4}5/.test(cpu))                   tags.push('amd-ryzen-5')
    else if (/ryzen.{0,4}3/.test(cpu))                   tags.push('amd-ryzen-3')
    else if (/celeron/.test(cpu))                         tags.push('intel-celeron')
    else if (/pentium/.test(cpu))                         tags.push('intel-pentium')

    // 3. RAM tier
    const ram = parseInt((a['ram'] ?? '').match(/(\d+)/)?.[1] ?? '0', 10)
    if (ram >= 32)      tags.push('32gb-ram')
    else if (ram >= 16) tags.push('16gb-ram')
    else if (ram >= 8)  tags.push('8gb-ram')
    else if (ram > 0)   tags.push('4gb-ram')

    // 4. Storage tier
    const stMatch = (a['storage'] ?? '').match(/(\d+(?:\.\d+)?)\s*(gb|tb)/i)
    if (stMatch) {
      const gb = stMatch[2].toLowerCase() === 'tb' ? parseFloat(stMatch[1]) * 1000 : parseFloat(stMatch[1])
      tags.push(gb >= 1000 ? '1tb-ssd' : gb >= 512 ? '512gb-ssd' : gb >= 256 ? '256gb-ssd' : '128gb-ssd')
    }

    // 5. Keyboard layout (already stored as attribute)
    if (a['keyboard_layout']) tags.push(a['keyboard_layout'])

    // 6. Use case
    if (/nitro|predator|gaming|game/.test(text))           tags.push('gaming')
    else if (/spin|convertible|2.in.1|2-in-1/.test(text)) tags.push('2-in-1')
    else if (/chromebook/.test(text))                      tags.push('chromebook')
    else if (/swift|ultrathin|slim|ultra/.test(text))      tags.push('ultrabook')
    else if (/vero|eco/.test(text))                        tags.push('eco')
    else                                                   tags.push('everyday')
  }

  // Deduplicate and cap at 6
  return [...new Set(tags)].slice(0, 6)
}

async function uploadProductInfo(
  sku: string,
  fields: { description?: string; status?: 'active' | 'archived'; categoryIds?: string[]; tags?: string[] },
): Promise<void> {
  // Note: omit `platforms` entirely (not []) — Zod schema requires min(1) if present.
  // Omitting means D1-only update, no platform push.
  const res = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...getAccessHeaders(),
    },
    body: JSON.stringify({ fields, triggeredBy: 'agent' }),
  })
  if (!res.ok) throw new Error(`Product PATCH ${res.status}: ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Process one product
// ---------------------------------------------------------------------------

async function processProduct(
  context: BrowserContext,
  sku: string,
  sourceUrl: string,
  sourceName: string,
  index: number,
  total: number,
  existing: { hasImages: boolean; hasDescription: boolean; hasAttributes: boolean; hasCategory: boolean },
): Promise<{ ok: number; skipped: number; errors: string[] }> {
  log(`[${index}/${total}] ${sku} → ${sourceUrl}`)

  const sourceLocale = detectLocale(sourceUrl)

  // ------------------------------------------------------------------
  // Step 1: Determine which URL to use for content extraction.
  //
  // Always try en-ie first — it provides English descriptions, images,
  // and spec labels (no translation needed).
  //
  // If the product is not on en-ie (store-exclusive product):
  //   → import the foreign description from sourceUrl
  //   → mark the product archived + needs-translation
  // ------------------------------------------------------------------
  let fetchLocale = sourceLocale
  let needsTranslation = false
  let pageData: ProductPageData | null = null

  if (sourceLocale !== 'en') {
    const enUrl = tryConstructEnglishUrl(sourceUrl)
    if (enUrl) {
      log(`  🇮🇪 Trying en-ie first: ${enUrl}`)
      try {
        const enData = await extractProductData(context, enUrl)
        if (enData.images.length > 0 || enData.description) {
          // Product exists on en-ie — use its content directly (no second visit needed)
          pageData    = enData
          fetchLocale = 'en'
          log(`  ✓  Found on en-ie — using English content`)
        } else {
          // Page loaded but no product content (redirected to homepage / 404-like)
          needsTranslation = true
          log(`  ⚠️  en-ie page empty — product not in Irish store, falling back to ${sourceLocale} URL`)
        }
      } catch {
        needsTranslation = true
        log(`  ⚠️  en-ie fetch failed — falling back to ${sourceLocale} URL`)
      }
    } else {
      // Can't construct en-ie URL (unknown category slug)
      needsTranslation = true
      log(`  ⚠️  Cannot map URL to en-ie — will use foreign URL (locale=${sourceLocale})`)
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Extract content from the original URL only if en-ie wasn't used
  // ------------------------------------------------------------------
  if (!pageData) {
    pageData = await extractProductData(context, sourceUrl)
  }

  const { images: imageRefs, specs: rawSpecs, description } = pageData
  log(`  Found ${imageRefs.length} image(s), ${Object.keys(rawSpecs).length} spec entries`)

  // ------------------------------------------------------------------
  // Step 3: Save description + flag product if translation is needed
  //   Skip entirely if description is already present in D1
  // ------------------------------------------------------------------
  if (existing.hasDescription) {
    log(`  ℹ️  Description already present — skipping`)
  } else if (description) {
    try {
      await uploadProductInfo(sku, {
        description,
        // Archive products whose description is not in English
        ...(needsTranslation ? { status: 'archived' } : {}),
      })
      if (needsTranslation) {
        log(`  📝 Foreign description saved (${fetchLocale ?? 'unknown'}) — product archived, needs translation`)
        log(`     ⚠️  [needs-translation] ${sku}: translate description then set status=active`)
      } else {
        log(`  📝 English description saved`)
      }
    } catch (err) {
      log(`  ⚠️  Description save failed: ${err instanceof Error ? err.message : err}`)
    }
  } else if (needsTranslation) {
    // No description found AND not on en-ie — still archive it
    try {
      await uploadProductInfo(sku, { status: 'archived' })
      log(`  ⚠️  [needs-translation] ${sku}: no description found (foreign store only) — product archived until translation`)
    } catch (err) {
      log(`  ⚠️  Status update failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Map spec attributes to English keys
  //   Skip entirely if attributes are already present in D1
  // ------------------------------------------------------------------
  const category = detectCategory(sourceName, sourceUrl)
  if (existing.hasAttributes) {
    log(`  ℹ️  Attributes already present — skipping`)
  } else if (category) {
    const unmappedLabels: string[] = []
    const attributes = mapSpecs(rawSpecs, category, fetchLocale, (label, value) => {
      unmappedLabels.push(`"${label}" = "${value}"`)
    })
    if (unmappedLabels.length > 0) {
      log(`  ⚠️  [unmapped-labels] ${unmappedLabels.length} spec label(s) not in map (${category}, locale=${fetchLocale ?? '?'}):`)
      for (const u of unmappedLabels) log(`       ${u}`)
      log(`       → Add these to ${category === 'monitor' ? 'MONITOR_LABEL_MAPS' : 'LAPTOP_LABEL_MAPS'}[${fetchLocale ?? '?'}] if needed.`)
    }
    // For laptops: append keyboard_layout derived from source URL locale
    if (category === 'laptops') {
      const layout = detectKeyboardLayout(sourceUrl)
      if (layout) {
        attributes.push({ key: 'keyboard_layout', value: layout })
        log(`  ⌨️  keyboard_layout = ${layout} (from ${detectFullLocale(sourceUrl) ?? sourceUrl})`)
      } else {
        log(`  ⚠️  keyboard_layout: no mapping for locale ${detectFullLocale(sourceUrl) ?? 'unknown'}`)
      }
    }
    if (attributes.length > 0) {
      try {
        await uploadAttributes(sku, attributes)
        log(`  📋 ${attributes.length} attributes saved (${category}, locale=${fetchLocale ?? 'unknown'})`)
      } catch (err) {
        log(`  ⚠️  Attributes failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      log(`  ℹ️  No mappable attributes found (${category}, locale=${fetchLocale ?? 'unknown'})`)
    }
  }

  // ------------------------------------------------------------------
  // Step 5: Assign shopify_tiktok collection (skip if already assigned)
  // ------------------------------------------------------------------
  if (category && !existing.hasCategory) {
    try {
      await assignCollection(sku, category)
    } catch (err) {
      log(`  ⚠️  Collection assignment failed: ${err instanceof Error ? err.message : err}`)
    }
  } else if (category && existing.hasCategory) {
    log(`  ℹ️  Collection already assigned — skipping`)
  }

  // ------------------------------------------------------------------
  // Step 6: Download + upload images to R2 (skip if already present)
  // ------------------------------------------------------------------
  if (existing.hasImages) {
    log(`  ℹ️  Images already present — skipping`)
    return { ok: 0, skipped: 0, errors: [] }
  }

  if (imageRefs.length === 0) {
    log(`  ⚠️  No images found on page`)
    return { ok: 0, skipped: 0, errors: ['No images found on page'] }
  }

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

  const errors: string[] = []
  let uploaded = 0
  const BATCH = 10
  for (let b = 0; b < files.length; b += BATCH) {
    const batch = files.slice(b, b + BATCH)
    const batchMode = b === 0 ? MODE : 'add'
    try {
      const result = await uploadImages(sku, batch, batchMode)
      uploaded += result.urls.length
      if (result.errors.length > 0) errors.push(...result.errors)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  log(`  ✅ ${uploaded}/${files.length} uploaded to R2${skipped > 0 ? `, ${skipped} download failures` : ''}`)

  // ------------------------------------------------------------------
  // Step 7: Generate + upload tags (always overwrite — improves as
  //   attributes fill in over successive runs)
  // ------------------------------------------------------------------
  if (category) {
    // Re-run mapSpecs without warnings — pure function, cheap, no side effects.
    // Needed because attributes may have been skipped (existing.hasAttributes).
    const attrsForTags = mapSpecs(rawSpecs, category, fetchLocale)
    if (category === 'laptops') {
      const layout = detectKeyboardLayout(sourceUrl)
      if (layout) attrsForTags.push({ key: 'keyboard_layout', value: layout })
    }
    const tags = generateTags(category, attrsForTags, sourceName, description)
    if (tags.length > 0) {
      try {
        await uploadProductInfo(sku, { tags })
        log(`  🏷️  Tags: ${tags.join(', ')}`)
      } catch (err) {
        log(`  ⚠️  Tag upload failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

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

  // Step 1 — fetch acer_store stock + shopify_tiktok collection map
  log('Fetching acer_store stock list and shopify_tiktok collections...')
  const [allRows] = await Promise.all([getAcerStockRows(), fetchTiktokCollectionMap()])
  const withUrl = allRows.filter(r => r.sourceUrl && r.sourceUrl !== 'null')

  // When targeting a single SKU, skip the status filter (allow re-fill of any product)
  const rows = withUrl
    .filter(r => !ONLY_SKU || r.productId === ONLY_SKU)
    .filter(r => ONLY_SKU || needsFilling(r))

  if (rows.length === 0) {
    log(`No products need filling (${withUrl.length} have Acer URLs — all complete or not pendingReview).`)
    process.exit(0)
  }

  if (IS_DRY_RUN) {
    log(`Found ${rows.length} product(s) to fill:`)
    rows.forEach(r => {
      const cat  = detectCategory(r.sourceName ?? '', r.sourceUrl ?? '')
      const missing = [
        r.imageCount === 0                      && 'no images',
        cat !== null && r.attributeCount === 0  && 'no attributes',
        cat !== null && r.categoryCount === 0   && 'no collection',
      ].filter(Boolean).join(', ')
      log(`  ${r.productId}  [${missing}]  →  ${r.sourceUrl}`)
    })
    process.exit(0)
  }

  // Step 2 — Phase A: assign collections to products that only need that (no browser visit needed)
  const collectionOnlyRows = rows.filter(r => needsCollectionOnly(r))
  if (collectionOnlyRows.length > 0) {
    log(`\nPhase A — assigning collections (${collectionOnlyRows.length} product(s), no browser needed)`)
    for (const row of collectionOnlyRows) {
      const cat = detectCategory(row.sourceName ?? '', row.sourceUrl ?? '') as InternalCategory
      log(`  ${row.productId} → ${cat}`)
      try {
        await assignCollection(row.productId, cat)
      } catch (err) {
        log(`  ❌ ${row.productId}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  // Step 3 — Phase B: browser fill for products needing images / description / attributes
  const browserRows = rows.filter(r => needsBrowserFill(r))
  if (browserRows.length === 0) {
    log(`\n✅ Done — all products already had images/description/attributes. Collections assigned above.`)
    process.exit(0)
  }

  log(`\nPhase B — browser fill (${browserRows.length} product(s))`)

  // Step 4 — launch real Chrome (avoids Acer bot detection)
  const browser: Browser = await chromium.launch({
    channel: 'chrome',
    headless: !IS_HEADED,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-IE',
  })

  // Step 5 — process each product
  let totalOk = 0
  let totalErrors = 0
  let i = 0

  const tasks = browserRows.map(row => async () => {
    const idx = ++i
    try {
      const result = await processProduct(
        context, row.productId, row.sourceUrl!, row.sourceName ?? '', idx, browserRows.length,
        {
          hasImages:     row.imageCount > 0,
          hasDescription: row.hasDescription,
          hasAttributes:  row.attributeCount > 0,
          hasCategory:    row.categoryCount > 0,
        },
      )
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
