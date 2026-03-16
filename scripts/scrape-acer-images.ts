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

type InternalCategory = 'monitor' | 'laptops'

let tiktokCollectionMap = new Map<InternalCategory, string>()

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
      if (!tiktokCollectionMap.has('monitor') &&
          (key.includes('monitor') || key.includes('display') || key.includes('screen') || key.includes('écran'))) {
        tiktokCollectionMap.set('monitor', col.id)
        log(`  🏷️  monitor → collection "${col.name}" (${col.id})`)
      }
      if (!tiktokCollectionMap.has('laptops') &&
          (key.includes('laptop') || key.includes('notebook') || key.includes('portable') || key.includes('ordinateur'))) {
        tiktokCollectionMap.set('laptops', col.id)
        log(`  🏷️  laptops → collection "${col.name}" (${col.id})`)
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
  if (!row.hasDescription) return true
  const cat = detectCategory(row.sourceName ?? '', row.sourceUrl ?? '')
  if (cat !== null && row.attributeCount === 0) return true
  return false
}

/** Has all browser data but still missing a shopify_tiktok collection. No page visit needed. */
function needsCollectionOnly(row: StockRow): boolean {
  if (!row.pendingReview) return false
  if (needsBrowserFill(row)) return false // will get collection assigned during browser fill
  const cat = detectCategory(row.sourceName ?? '', row.sourceUrl ?? '')
  return cat !== null && row.categoryCount === 0
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
  'laptops': 'laptops', 'laptop': 'laptops',
  'ordinateurs-portables': 'laptops', 'ordenadores-portatiles': 'laptops',
  'laptopy': 'laptops', 'baerbare-computere': 'laptops',
  'barbara-datorer': 'laptops', 'baebare-pc': 'laptops', 'kannettavat': 'laptops',
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

/** Rewrite any Acer store product URL to its en-ie equivalent, or return null. */
function tryConstructEnglishUrl(sourceUrl: string): string | null {
  const m = sourceUrl.match(/^(https:\/\/store\.acer\.com\/)([a-z]{2}-[a-z]{2})\/([^/?#]+)\/(.+)$/)
  if (!m) return null
  if (m[2] === 'en-ie') return sourceUrl // already English
  const enCat = TO_EN_IE_CAT[m[3]]
  if (!enCat) return null
  return `${m[1]}en-ie/${enCat}/${m[4]}`
}

// ---------------------------------------------------------------------------
// Category detection
// ---------------------------------------------------------------------------

type ProductCategory = 'monitor' | 'laptops' | null

function detectCategory(sourceName: string, sourceUrl: string): ProductCategory {
  const n = sourceName.toLowerCase()
  const u = sourceUrl.toLowerCase()

  // --- Monitor: URL slug first (most reliable) ---
  if (u.includes('ecran')         // FR: /ecrans
   || u.includes('monitore')      // DE: /monitore, NL: /monitoren, ES: /monitores, PL: /monitory
   || u.includes('monitor')       // EN: /monitors, IT: /monitor, DA/SV/NO: /monitorer
   || u.includes('skærm')         // DA: /skærme
   || u.includes('sk%c3%a6rm')    // DA URL-encoded ærm
   || u.includes('skärm')         // SV: /skärmar
   || u.includes('sk%c3%a4rm')    // SV URL-encoded ärm
   || u.includes('skjerm')        // NO: /skjermer
   || u.includes('schermi')       // IT: /schermi
   || u.includes('n%c3%a4yt')     // FI URL-encoded näyt
   || u.includes('näyt')          // FI: /näytöt
  ) return 'monitor'
  // Name-based fallback
  if (n.includes('écran') || n.includes('ecran') || n.includes('monitor')
   || n.includes('scherm') || n.includes('skærm') || n.includes('skärm')
   || n.includes('skjerm') || n.includes('schermo') || n.includes('näyttö')
  ) return 'monitor'

  // --- Laptop: URL slug ---
  if (u.includes('laptop') || u.includes('notebook') || u.includes('ordinateur-portable')
   || u.includes('portables') || u.includes('ordenadores-portatiles')
   || u.includes('barbar')        // SV: bärbara / DA: bærbare
   || u.includes('b%c3%a4rbar') || u.includes('b%c3%a6rbar')
   || u.includes('kannettav')     // FI: kannettavat
  ) return 'laptops'
  // Name-based fallback
  if (n.includes('ordinateur') || n.includes('portable') || n.includes('laptop')
   || n.includes('notebook') || n.includes('portátil') || n.includes('kannettava')
  ) return 'laptops'

  return null
}

// ---------------------------------------------------------------------------
// Locale detection from source URL
// store.acer.com/fr-fr/… → 'fr'   store.acer.com/de-de/… → 'de'
// ---------------------------------------------------------------------------

function detectLocale(sourceUrl: string): string | null {
  const m = sourceUrl.match(/store\.acer\.com\/([a-z]{2})-[a-z]{2}\//)
  return m ? m[1] : null
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
    'type de panneau':               'screen_type',
    "type d'écran":                  'screen_type',
    'fréquence de rafraîchissement': 'refresh_rate',
    'écran tactile':                 'touchscreen',
    'mémoire ram':                   'ram',
    'ram':                           'ram',
    'type de ram':                   'ram_type',
    'ram maximale':                  'ram_max',
    'stockage':                      'storage',
    'capacité de stockage':          'storage',
    'type de stockage':              'storage_type',
  },
  de: { // [✓] de-de — German
    'bildschirmdiagonale':           'screen_size',
    'maximale auflösung':            'resolution',
    'panel-technologie':             'screen_type',
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
  },
  nl: { // nl-nl / nl-be [best-guess]
    'beeldschermdiagonaal':          'screen_size',
    'maximale resolutie':            'resolution',
    'paneeltechnologie':             'screen_type',
    'processor':                     'processor_model',
    'processormerk':                 'processor_brand',
    'verversingsfrequentie':         'refresh_rate',
    'touchscreen':                   'touchscreen',
    'werkgeheugen':                  'ram',
    'ram':                           'ram',
    'opslagcapaciteit':              'storage',
    'opslagtype':                    'storage_type',
  },
  es: { // es-es [best-guess]
    'diagonal de pantalla':          'screen_size',
    'resolución máxima':             'resolution',
    'tecnología del panel':          'screen_type',
    'procesador':                    'processor_model',
    'marca del procesador':          'processor_brand',
    'frecuencia de actualización':   'refresh_rate',
    'pantalla táctil':               'touchscreen',
    'memoria ram':                   'ram',
    'ram':                           'ram',
    'almacenamiento':                'storage',
    'tipo de almacenamiento':        'storage_type',
  },
  it: { // it-it [best-guess]
    'diagonale schermo':             'screen_size',
    'risoluzione massima':           'resolution',
    'tecnologia del pannello':       'screen_type',
    'processore':                    'processor_model',
    'marca del processore':          'processor_brand',
    'frequenza di aggiornamento':    'refresh_rate',
    'touchscreen':                   'touchscreen',
    'memoria ram':                   'ram',
    'ram':                           'ram',
    'memoria di archiviazione':      'storage',
    'tipo di archiviazione':         'storage_type',
  },
  pl: { // pl-pl [best-guess]
    'przekątna ekranu':              'screen_size',
    'maksymalna rozdzielczość':      'resolution',
    'technologia panelu':            'screen_type',
    'procesor':                      'processor_model',
    'marka procesora':               'processor_brand',
    'częstotliwość odświeżania':     'refresh_rate',
    'ekran dotykowy':                'touchscreen',
    'pamięć ram':                    'ram',
    'ram':                           'ram',
    'pojemność pamięci':             'storage',
    'typ pamięci masowej':           'storage_type',
  },
  da: { // da-dk [best-guess]
    'skærmstørrelse':                'screen_size',
    'maksimal opløsning':            'resolution',
    'panelteknologi':                'screen_type',
    'processor':                     'processor_model',
    'opdateringshastighed':          'refresh_rate',
    'touchskærm':                    'touchscreen',
    'hukommelse':                    'ram',
    'ram':                           'ram',
    'lagerkapacitet':                'storage',
    'lagertype':                     'storage_type',
  },
  sv: { // sv-se [best-guess]
    'skärmstorlek':                  'screen_size',
    'maximal upplösning':            'resolution',
    'panelteknik':                   'screen_type',
    'processor':                     'processor_model',
    'uppdateringsfrekvens':          'refresh_rate',
    'pekskärm':                      'touchscreen',
    'arbetsminne':                   'ram',
    'ram':                           'ram',
    'lagringskapacitet':             'storage',
    'lagringstyp':                   'storage_type',
  },
  no: { // no-no [best-guess]
    'skjermstørrelse':               'screen_size',
    'maksimal oppløsning':           'resolution',
    'panelteknologi':                'screen_type',
    'prosessor':                     'processor_model',
    'oppdateringsfrekvens':          'refresh_rate',
    'berøringsskjerm':               'touchscreen',
    'minne':                         'ram',
    'ram':                           'ram',
    'lagringskapasitet':             'storage',
    'lagringstype':                  'storage_type',
  },
  fi: { // fi-fi [best-guess]
    'näytön koko':                   'screen_size',
    'maksimitarkkuus':               'resolution',
    'paneelitekniikka':              'screen_type',
    'prosessori':                    'processor_model',
    'virkistystaajuus':              'refresh_rate',
    'kosketusnäyttö':                'touchscreen',
    'muisti':                        'ram',
    'ram':                           'ram',
    'tallennuskapasiteetti':         'storage',
    'tallennustyyppi':               'storage_type',
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
      // Warn about any non-trivial unmapped label so the user can extend the maps
      if (label.length >= 3 && warnUnmapped) warnUnmapped(rawLabel, rawValue)
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

      // Description — extract as plain text (rule: no HTML to sales channels)
      // Acer Store (Magento 2): short description is in .product.attribute.description .value
      const descEl = document.querySelector<HTMLElement>(
        '.product.attribute.description .value, .product-attribute-description .value, .overview .value'
      )
      let description: string | null = null
      if (descEl) {
        // Replace block-level elements with newlines before reading textContent
        const clone = descEl.cloneNode(true) as HTMLElement
        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
        clone.querySelectorAll('p, li, div, h1, h2, h3, h4').forEach(el => {
          el.textContent = (el.textContent ?? '') + '\n'
        })
        const raw = (clone.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
        if (raw.length > 10) description = raw
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

async function uploadProductInfo(
  sku: string,
  fields: { description?: string; status?: 'active' | 'archived'; categoryIds?: string[] },
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
        r.imageCount === 0             && 'no images',
        !r.hasDescription              && 'no description',
        cat !== null && r.attributeCount === 0 && 'no attributes',
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
