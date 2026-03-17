import { readFile } from 'node:fs/promises'

type ProductCategory =
  | 'monitor'
  | 'laptops'
  | 'tablets'
  | 'desktops'
  | 'audio'
  | 'gpu'
  | 'input-device'
  | 'cases'
  | 'lifestyle'

interface ProductRow {
  id: string
  title: string
  description: string | null
  tags: string | null
  status: string
  sourceUrl: string | null
  sourceName: string | null
}

interface AttributeRow {
  productId: string
  key: string
  value: string | null
  type: string | null
}

interface ProductUpdate {
  title?: string
  description?: string | null
  tags?: string[]
}

interface AttributeUpdate {
  key: string
  value: string | null
  type?: string | null
}

interface EnglishSearchHit {
  title: string | null
}

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const FORCE = args.has('--force')
const LIMIT = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? '0') || null
const ONLY_SKU = process.argv.find((arg) => arg.startsWith('--sku='))?.split('=')[1] ?? null
const CONCURRENCY = Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] ?? '4') || 4

const ACCOUNT_ID = '22289f45fec4c8545c8a47f6d768cad9'
const DB_ID = 'd7471ca2-fe58-4066-a946-367d062e7e95'

const KEYBOARD_LAYOUT_BY_LOCALE: Record<string, string> = {
  'en-ie': 'uk_qwerty',
  'fr-fr': 'fr_azerty',
  'fr-be': 'be_azerty',
  'nl-be': 'be_azerty',
  'de-de': 'de_qwertz',
  'es-es': 'es_qwerty',
  'it-it': 'it_qwerty',
  'pl-pl': 'pl_qwerty',
  'nl-nl': 'nl_qwerty',
  'sv-se': 'nordic',
  'fi-fi': 'nordic',
  'no-no': 'nordic',
  'da-dk': 'nordic',
}

const NON_EN_YES = new Set(['ja', 'oui', 'sì', 'sí', 'sim', 'tak', 'kyllä'])
const NON_EN_NO = new Set(['nej', 'nei', 'ei', 'nein', 'non', 'nee', 'nie', 'não', 'no'])

const NON_EN_COLORS: Record<string, string> = {
  svart: 'Black',
  musta: 'Black',
  noir: 'Black',
  schwarz: 'Black',
  zwart: 'Black',
  nero: 'Black',
  negro: 'Black',
  czarny: 'Black',
  sort: 'Black',
  hopea: 'Silver',
  silber: 'Silver',
  argent: 'Silver',
  argento: 'Silver',
  zilver: 'Silver',
  sølv: 'Silver',
  solv: 'Silver',
  gris: 'Gray',
  grau: 'Gray',
  grijs: 'Gray',
  harmaa: 'Gray',
  grå: 'Gray',
  gra: 'Gray',
  szary: 'Gray',
  grigio: 'Gray',
  blanc: 'White',
  weiß: 'White',
  weiss: 'White',
  wit: 'White',
  valkoinen: 'White',
  hvid: 'White',
  hvit: 'White',
  vit: 'White',
  biały: 'White',
  bialy: 'White',
  bianco: 'White',
  blanco: 'White',
  bleu: 'Blue',
  blau: 'Blue',
  blauw: 'Blue',
  sininen: 'Blue',
  blå: 'Blue',
  bla: 'Blue',
  niebieski: 'Blue',
  blu: 'Blue',
  azul: 'Blue',
  rouge: 'Red',
  rot: 'Red',
  rood: 'Red',
  punainen: 'Red',
  rød: 'Red',
  rod: 'Red',
  röd: 'Red',
  czerwony: 'Red',
  rosso: 'Red',
  rojo: 'Red',
  goud: 'Gold',
  kulta: 'Gold',
  guld: 'Gold',
  złoty: 'Gold',
  zloty: 'Gold',
  oro: 'Gold',
  vert: 'Green',
  grün: 'Green',
  grun: 'Green',
  groen: 'Green',
  vihreä: 'Green',
  vihrea: 'Green',
  grøn: 'Green',
  gron: 'Green',
  grønn: 'Green',
  grønnn: 'Green',
  grön: 'Green',
  zielony: 'Green',
  verde: 'Green',
}

const TITLE_DESC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bordenador gaming de sobremesa\b/gi, 'Gaming Desktop'],
  [/\bordenadores gaming de sobremesa\b/gi, 'Gaming Desktop'],
  [/\bordinateur gaming de bureau\b/gi, 'Gaming Desktop'],
  [/\bordinateurs gaming de bureau\b/gi, 'Gaming Desktop'],
  [/\bordinateur portable gamer\b/gi, 'Gaming Laptop'],
  [/\bordinateur portable\b/gi, 'Laptop'],
  [/\bportátil gaming\b/gi, 'Gaming Laptop'],
  [/\bportatil gaming\b/gi, 'Gaming Laptop'],
  [/\bpelikannettava\b/gi, 'Gaming Laptop'],
  [/\bnotebook gaming\b/gi, 'Gaming Notebook'],
  [/\bgaming notebook\b/gi, 'Gaming Notebook'],
  [/\bmonitor gaming\b/gi, 'Gaming Monitor'],
  [/\bproyector\b/gi, 'Projector'],
  [/\bprojecteur\b/gi, 'Projector'],
  [/\bmochila\b/gi, 'Backpack'],
  [/\brugzak\b/gi, 'Backpack'],
  [/\bsac a dos\b/gi, 'Backpack'],
  [/Pantalla Táctil/gi, 'Touchscreen'],
  [/Pantalla Tactil/gi, 'Touchscreen'],
  [/\bmouse vertical\b/gi, 'Vertical Mouse'],
  [/\btactile\b/gi, 'Touch'],
  [/Écran tactile/gi, 'Touchscreen'],
  [/\bÃ©cran tactile\b/gi, 'Touchscreen'],
  [/ecran tactile/gi, 'Touchscreen'],
  [/Écran Touch/gi, 'Touchscreen'],
  [/\bÃ©cran touch\b/gi, 'Touchscreen'],
  [/ecran touch/gi, 'Touchscreen'],
  [/\bultrafin\b/gi, 'Ultra-thin'],
  [/ultra sottile/gi, 'Ultra-thin'],
  [/\bverticale muis\b/gi, 'Vertical Mouse'],
  [/\bverticale souris\b/gi, 'Vertical Mouse'],
  [/\bdesktop-computer\b/gi, 'Desktop'],
  [/\bordinateur de bureau\b/gi, 'Desktop'],
  [/\bordinateur bureau\b/gi, 'Desktop'],
  [/\bordenadores? sobremesa\b/gi, 'Desktop'],
  [/\bordenador de sobremesa\b/gi, 'Desktop'],
  [/\bsobremesa gaming\b/gi, 'Gaming Desktop'],
  [/\bsoporte para portátiles\b/gi, 'Laptop Stand'],
  [/\bsoporte para portatiles\b/gi, 'Laptop Stand'],
  [/\bsupport pour portables\b/gi, 'Laptop Stand'],
  [/\bkabellose tastatur und maus\b/gi, 'Wireless Keyboard and Mouse'],
  [/\bwireless-tastatur\b/gi, 'Wireless Keyboard'],
  [/\bdeutsches tastaturlayout\b/gi, 'German Keyboard Layout'],
  [/\bdeutsches\b/gi, 'German'],
  [/\bdeutscher\b/gi, 'German'],
  [/\bwireless keyboard and mouse\b/gi, 'Wireless Keyboard and Mouse'],
  [/\bwireless keyboard\b/gi, 'Wireless Keyboard'],
  [/\bwireless mouse\b/gi, 'Wireless Mouse'],
  [/\bclavier et souris\b/gi, 'Keyboard and Mouse'],
  [/\bteclado y ratón\b/gi, 'Keyboard and Mouse'],
  [/\bteclado y raton\b/gi, 'Keyboard and Mouse'],
  [/\btastiera e mouse\b/gi, 'Keyboard and Mouse'],
  [/\btoetsenbord en muis\b/gi, 'Keyboard and Mouse'],
  [/\btastatur og mus\b/gi, 'Keyboard and Mouse'],
  [/\btangentbord och mus\b/gi, 'Keyboard and Mouse'],
  [/\bnäppäimistö ja hiiri\b/gi, 'Keyboard and Mouse'],
  [/\badaptador\b/gi, 'Adapter'],
  [/\badaptateur\b/gi, 'Adapter'],
  [/\badattatore\b/gi, 'Adapter'],
  [/\badapter\b/gi, 'Adapter'],
  [/\bteclado\b/gi, 'Keyboard'],
  [/\bratón\b/gi, 'Mouse'],
  [/\braton\b/gi, 'Mouse'],
  [/\bclavier\b/gi, 'Keyboard'],
  [/\bsouris\b/gi, 'Mouse'],
  [/\btastatur\b/gi, 'Keyboard'],
  [/\bmaus\b/gi, 'Mouse'],
  [/\btoetsenbord\b/gi, 'Keyboard'],
  [/\bmuis\b/gi, 'Mouse'],
  [/\bportátil\b/gi, 'Laptop'],
  [/\bportatil\b/gi, 'Laptop'],
  [/\bportable\b/gi, 'Laptop'],
  [/\bnotebook\b/gi, 'Notebook'],
  [/\bgamer\b/gi, 'Gaming'],
  [/\bsistema operativo\b/gi, 'Operating System'],
  [/\bsystème d'exploitation\b/gi, 'Operating System'],
  [/\bbetriebssystem\b/gi, 'Operating System'],
  [/\bbesturingssysteem\b/gi, 'Operating System'],
  [/\boperativsystem\b/gi, 'Operating System'],
  [/\bstyresystem\b/gi, 'Operating System'],
  [/\bkäyttöjärjestelmä\b/gi, 'Operating System'],
  [/\bprocessore\b/gi, 'Processor'],
  [/\bprocesseur\b/gi, 'Processor'],
  [/\bprozessor\b/gi, 'Processor'],
  [/\bprocesador\b/gi, 'Processor'],
  [/\bprocesor\b/gi, 'Processor'],
  [/\bprocessor\b/gi, 'processor'],
  [/\bcon memoria dedicada\b/gi, 'with dedicated memory'],
  [/\bcon memoria compartida\b/gi, 'with shared memory'],
  [/\bcon memoria condivisa\b/gi, 'with shared memory'],
  [/\bcon memoria dedicata\b/gi, 'with dedicated memory'],
  [/\bavec mémoire dédiée\b/gi, 'with dedicated memory'],
  [/\bavec mémoire partagée\b/gi, 'with shared memory'],
  [/\bmit dediziertem speicher\b/gi, 'with dedicated memory'],
  [/\bmit gemeinsam genutztem speicher\b/gi, 'with shared memory'],
  [/\btoegewijd geheugen\b/gi, 'dedicated memory'],
  [/\btoegewijde geheugen\b/gi, 'dedicated memory'],
  [/\bmet gedeeld geheugen\b/gi, 'with shared memory'],
  [/\bmet dedicated geheugen\b/gi, 'with dedicated memory'],
  [/\bgedeeld geheugen\b/gi, 'shared memory'],
  [/\bjaettu muisti\b/gi, 'shared memory'],
  [/\bomistettu muisti\b/gi, 'dedicated memory'],
  [/\bmemoria dedicada\b/gi, 'dedicated memory'],
  [/\bmemoria compartida\b/gi, 'shared memory'],
  [/\bmemoria condivisa\b/gi, 'shared memory'],
  [/\bmémoire dédiée\b/gi, 'dedicated memory'],
  [/\bmémoire partagée\b/gi, 'shared memory'],
  [/\bdediziertem speicher\b/gi, 'dedicated memory'],
  [/\bgemeinsam genutztem speicher\b/gi, 'shared memory'],
  [/\btecnologia\b/gi, 'Technology'],
  [/\btecnología\b/gi, 'Technology'],
  [/\btecnologie\b/gi, 'Technology'],
  [/\bteknologi\b/gi, 'Technology'],
  [/\btekniikka\b/gi, 'Technology'],
  [/\btechnologie\b/gi, 'Technology'],
  [/\bavec\b/gi, 'with'],
  [/\bmit\b/gi, 'with'],
  [/\bcon\b/gi, 'with'],
  [/\bmet\b/gi, 'with'],
  [/\bkanssa\b/gi, 'with'],
  [/\bprosessori\b/gi, 'Processor'],
  [/\bomistettu\b/gi, 'dedicated'],
  [/\bmatta\b/gi, 'matte'],
  [/\bnayttoruudun\b/gi, 'display'],
  [/\bnÃ¤yttÃ¶ruudun\b/gi, 'display'],
  [/\bnayton\b/gi, 'display'],
  [/\bnÃ¤ytÃ¶n\b/gi, 'display'],
  [/\bnaytto\b/gi, 'display'],
  [/\bnÃ¤yttÃ¶\b/gi, 'display'],
  [/\bniet inbegrepen\b/gi, 'NOT included'],
  [/\beinbegrepen\b/gi, 'included'],
  [/\bgemaakt van\b/gi, 'Made from'],
  [/gerecyclede materialen om onze planeet te redden/gi, 'recycled materials to help save our planet'],
  [/gerecyclede bodem van natuurlijk rubber/gi, 'recycled natural rubber base'],
  [/het oppervlak is/gi, 'The surface is'],
  [/\bweegt slechts\b/gi, 'Weighs only'],
  [/\bgeschikt voor\b/gi, 'Suitable for'],
  [/\bperfect voor werk of reizen\b/gi, 'perfect for work or travel'],
  [/\bbovenhandvat\b/gi, 'top handle'],
  [/\bgerecyclede plastic flessen\b/gi, 'recycled plastic bottles'],
  [/\bvoor dagelijks comfort\b/gi, 'for everyday comfort'],
  [/\btot (\d+(?:\.\d+)?)\"/gi, 'up to $1\"'],
  [/\bvoor snel en makkelijk meenemen\b/gi, 'for quick and easy carrying'],
  [/\bantimicrobieel\b/gi, 'antimicrobial'],
  [/\bmateriaal\b/gi, 'material'],
  [/\ben bluetooth\b/gi, 'and Bluetooth'],
  [/\bdraadloze verbinding\b/gi, 'wireless connection'],
  [/\btot (\d+) uur batterijduur\b/gi, 'Up to $1 hours of battery life'],
  [/\bzonder achtergrondverlichting\b/gi, 'without backlight'],
  [/\boled-display\b/gi, 'OLED display'],
  [/\bscherm voor dpi en batterijstatus\b/gi, 'display for DPI and battery status'],
  [/\bergonomisch verticaal ontwerp\b/gi, 'ergonomic vertical design'],
  [/\boplaadbare batterij\b/gi, 'rechargeable battery'],
  [/\b(\d+) uur oplaadtijd\b/gi, '$1 hours charging time'],
  [/\bmicro-usb-opl[a-z]*/gi, 'Micro-USB charging'],
  [/\bresolutie\b/gi, 'Resolution'],
  [/\bbeeldverhouding\b/gi, 'Aspect ratio'],
  [/\boorspronkelijk\b/gi, 'Native'],
  [/\bhelderheid\b/gi, 'Brightness'],
  [/stylet actif/gi, 'Active Stylus'],
  [/Lápiz digital Active Stylus/gi, 'Active Stylus'],
  [/Lapiz digital Active Stylus/gi, 'Active Stylus'],
  [/Penna Attiva/gi, 'Active Stylus'],
  [/Progettato per una esperienza senza compromessi/gi, 'Designed for an uncompromising experience'],
  [/Incl\./g, 'Includes'],
  [/\bÃ©blouissement\b/gi, 'Glare'],
  [/\bÉblouissement\b/gi, 'Glare'],
  [/\beblouissement\b/gi, 'Glare'],
  [/\bips-paneeli\b/gi, 'IPS Panel'],
  [/\bopaco\b/gi, 'matte'],
  [/\bmate\b/gi, 'matte'],
  [/\bmat\b/gi, 'matte'],
  [/\bbatterien\b/gi, 'batteries'],
  [/\bbaterías\b/gi, 'batteries'],
  [/\bbatterie\b/gi, 'batteries'],
  [/\bbatterijen\b/gi, 'batteries'],
  [/\btastenkombinationen\b/gi, 'keyboard shortcuts'],
  [/\btastenanschlägen\b/gi, 'keystrokes'],
  [/\btastenanschlagen\b/gi, 'keystrokes'],
  [/\bauflösung\b/gi, 'resolution'],
  [/\bauflosung\b/gi, 'resolution'],
  [/\bfunktionsmaus\b/gi, 'wireless mouse'],
  [/\bfunkmaus\b/gi, 'wireless mouse'],
  [/\bmit einer cpi-auflösung von\b/gi, 'with a CPI resolution of'],
  [/\bmit einer lebensdauer von\b/gi, 'with a lifespan of'],
  [/\breceiver mit usb-schnittstelle\b/gi, 'Receiver with USB interface'],
  [/\binkl\.\b/gi, 'Includes'],
  [/\bincl\.\b/gi, 'Includes'],
  [/\bnicht enthalten\b/gi, 'NOT included'],
  [/\bnon inclus[eo]\b/gi, 'NOT included'],
  [/\bno incluido[s]?\b/gi, 'NOT included'],
]

const SEARCH_CACHE = new Map<string, Promise<EnglishSearchHit>>()

function log(message: string): void {
  const stamp = new Date().toISOString()
  console.log(`[translate-en ${stamp}] ${message}`)
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    out[key] = value
  }
  return out
}

function pickEnv(name: string, vars: Record<string, string>): string {
  const value = process.env[name] ?? vars[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

function maybeDecodeMojibake(input: string): string {
  let current = input
  for (let i = 0; i < 2; i += 1) {
    if (!/[ÃÂâ]/.test(current)) break
    const decoded = Buffer.from(current, 'latin1').toString('utf8')
    if ((decoded.match(/[ÃÂâ]/g)?.length ?? 0) < (current.match(/[ÃÂâ]/g)?.length ?? 0)) {
      current = decoded
      continue
    }
    break
  }
  return current
}

function cleanWhitespace(input: string): string {
  return input
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeText(input: string): string {
  let out = maybeDecodeMojibake(input)
  out = out
    .replace(/Â®/g, '®')
    .replace(/Â™/g, '™')
    .replace(/â„¢/g, '™')
    .replace(/â€™/g, "'")
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .replace(/â€¢/g, '•')
    .replace(/â€¦/g, '...')
    .replace(/Ã—/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\)\s*([A-Za-z])/g, ') $1')
  return cleanWhitespace(out)
}

function replaceColors(input: string): string {
  const words = input.split(/(\b)/)
  return words.map((part) => {
    const key = normalizeText(part).toLowerCase()
    return NON_EN_COLORS[key] ?? part
  }).join('')
}

function translateFreeText(input: string): string {
  let out = normalizeText(input)
  out = replaceColors(out)
  for (const [pattern, replacement] of TITLE_DESC_REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  out = out
    .replace(/\bGo\b/g, 'GB')
    .replace(/\bTo\b/g, 'TB')
    .replace(/\bMo\b/g, 'MB')
    .replace(/\bGaming Laptop\b/gi, 'Gaming Laptop')
    .replace(/\bGaming Notebook\b/gi, 'Gaming Notebook')
    .replace(/\bGaming Monitor\b/gi, 'Gaming Monitor')
    .replace(/\bLaptop Gaming\b/gi, 'Gaming Laptop')
    .replace(/\bNotebook Gaming\b/gi, 'Gaming Notebook')
    .replace(/\bMonitor Gaming\b/gi, 'Gaming Monitor')
    .replace(/\bprocessor\b/gm, 'Processor')
    .replace(/\boperating system\b/gm, 'Operating System')
    .replace(/\btechnology ips\b/gi, 'IPS Technology')
    .replace(/\s+\|\s+/g, ' | ')
    .replace(/\s+-\s+/g, ' - ')
  return cleanWhitespace(out)
}

function normalizeSpecValue(key: string, raw: string): string {
  const value = normalizeText(raw)
  if (key === 'panel_type') {
    return translateFreeText(value)
      .replace(/ComfyView \(matte\)\s+Näyttöruudun\s+IPS Panel\s+Technology/gi, 'ComfyView (matte) IPS Panel Technology')
      .replace(/ComfyView \(matte\)\s+display\s+IPS Panel\s+Technology/gi, 'ComfyView (matte) IPS Panel Technology')
      .replace(/ComfyView \(matte\)\s+NÃ¤yttÃ¶ruudun\s+IPS-paneeli\s+Technology/gi, 'ComfyView (matte) IPS Panel Technology')
      .replace(/CineCrystal \(Éblouissement\)\s+IPS Technology/gi, 'CineCrystal (Glare) IPS Technology')
      .replace(/CineCrystal \((?:Glare|Ã‰blouissement)\)\s+IPS Technology/gi, 'CineCrystal (Glare) IPS Technology')
  }
  if (key === 'screen_size') {
    const zoll = value.match(/\((\d+(?:\.\d+)?)\s*zoll\)/i)
    if (zoll) return zoll[1]
    const cmToInches = value.match(/(\d+(?:\.\d+)?)\s*cm/i)
    if (cmToInches) return cmToInches[1]
    const m = value.match(/(\d+(?:\.\d+)?)/)
    return m ? m[1] : value
  }
  if (key === 'resolution') {
    return value.replace(/\s*[x×]\s*/gi, 'x')
  }
  if (key === 'refresh_rate' || key === 'brightness' || key === 'response_time') {
    const m = value.match(/(\d+(?:\.\d+)?)/)
    return m ? m[1] : value
  }
  if (key === 'touchscreen' || key === 'curved') {
    const lower = value.toLowerCase()
    if (NON_EN_YES.has(lower)) return 'Yes'
    if (NON_EN_NO.has(lower)) return 'No'
  }
  if (key === 'color') {
    const direct = NON_EN_COLORS[value.toLowerCase()]
    if (direct) return direct
  }
  return translateFreeText(value)
}

function detectCategory(sourceName: string, sourceUrl: string): ProductCategory {
  const n = normalizeText(sourceName).toLowerCase()
  const u = sourceUrl.toLowerCase()

  if (
    u.includes('ecran') ||
    u.includes('monitore') ||
    u.includes('monitor') ||
    u.includes('skærm') ||
    u.includes('sk%c3%a6rm') ||
    u.includes('skärm') ||
    u.includes('sk%c3%a4rm') ||
    u.includes('skjerm') ||
    u.includes('schermi') ||
    u.includes('n%c3%a4yt') ||
    u.includes('näyt')
  ) return 'monitor'
  if (
    n.includes('écran') ||
    n.includes('ecran') ||
    n.includes('monitor') ||
    n.includes('scherm') ||
    n.includes('skærm') ||
    n.includes('skärm') ||
    n.includes('skjerm') ||
    n.includes('schermo') ||
    n.includes('näyttö')
  ) return 'monitor'

  if (
    u.includes('laptop') ||
    u.includes('notebook') ||
    u.includes('ordinateur-portable') ||
    u.includes('portables') ||
    u.includes('ordenadores-portatiles') ||
    u.includes('barbar') ||
    u.includes('baerbar') ||
    u.includes('b%c3%a4rbar') ||
    u.includes('b%c3%a6rbar') ||
    u.includes('kannettav') ||
    u.includes('/portatil')
  ) return 'laptops'
  if (
    n.includes('ordinateur') ||
    n.includes('portable') ||
    n.includes('laptop') ||
    n.includes('notebook') ||
    n.includes('portátil') ||
    n.includes('kannettava') ||
    n.includes('pelikannettava')
  ) return 'laptops'

  if (u.includes('tablet') || u.includes('tablette') || u.includes('tabletas') || u.includes('tabletti')) return 'tablets'
  if (n.includes('tablet') || n.includes('tablette') || n.includes('tableta') || n.includes(' tab ')) return 'tablets'

  if (
    u.includes('desktop') ||
    u.includes('ordinateur-de-bureau') ||
    u.includes('ordenadores-sobremesa') ||
    u.includes('desktop-computer')
  ) return 'desktops'
  if (
    n.includes('desktop') ||
    n.includes('all-in-one') ||
    n.includes('allinone') ||
    n.includes('veriton') ||
    n.includes('aspire tc') ||
    n.includes('aspire xc') ||
    n.includes('bureau') ||
    n.includes('torre')
  ) return 'desktops'

  if (
    u.includes('/audio') ||
    u.includes('/casques') ||
    u.includes('/kopfhoer') ||
    u.includes('/headset') ||
    u.includes('/headphone')
  ) return 'audio'
  if (
    n.includes('headset') ||
    n.includes('headphone') ||
    n.includes('earphone') ||
    n.includes('speaker') ||
    n.includes('casque') ||
    n.includes('kopfhörer') ||
    n.includes('écouteur') ||
    n.includes('enceinte')
  ) return 'audio'

  if (u.includes('/gpu') || u.includes('/graphics') || u.includes('/carte-graphique') || u.includes('/grafik')) return 'gpu'
  if (n.includes(' gpu') || n.includes('graphics card') || n.includes('carte graphique') || n.includes('grafikkarte')) return 'gpu'

  if (
    u.includes('/mice') ||
    u.includes('/keyboards') ||
    u.includes('/souris') ||
    u.includes('/claviers') ||
    u.includes('/maus') ||
    u.includes('/tastatur') ||
    u.includes('/muizen') ||
    u.includes('/toetsenbord')
  ) return 'input-device'
  if (
    n.includes('mouse') ||
    n.includes('mice') ||
    n.includes('keyboard') ||
    n.includes('souris') ||
    n.includes('clavier') ||
    n.includes('maus') ||
    n.includes('tastatur') ||
    n.includes('muis') ||
    n.includes('toetsenbord')
  ) return 'input-device'

  if (u.includes('/cases') || u.includes('/bags') || u.includes('/housse') || u.includes('/tasche') || u.includes('/sac')) return 'cases'
  if (
    n.includes('case') ||
    n.includes('sleeve') ||
    n.includes('backpack') ||
    n.includes('bag') ||
    n.includes('housse') ||
    n.includes('sacoche') ||
    n.includes('tasche') ||
    n.includes('rucksack')
  ) return 'cases'

  return 'lifestyle'
}

function detectFullLocale(sourceUrl: string): string | null {
  const match = sourceUrl.match(/store\.acer\.com\/([a-z]{2}-[a-z]{2})\//)
  return match?.[1] ?? null
}

function detectKeyboardLayout(sourceUrl: string): string | null {
  const locale = detectFullLocale(sourceUrl)
  return locale ? (KEYBOARD_LAYOUT_BY_LOCALE[locale] ?? null) : null
}

function generateTags(
  category: ProductCategory,
  attrs: Array<{ key: string; value: string }>,
  title: string,
  description: string | null,
): string[] {
  const attrMap = Object.fromEntries(attrs.map((attr) => [attr.key, attr.value.toLowerCase()]))
  const text = `${title} ${description ?? ''}`.toLowerCase()
  const tags: string[] = []

  if (category === 'monitor') {
    const screenSize = parseFloat(attrMap.screen_size ?? '')
    if (!Number.isNaN(screenSize)) {
      tags.push(screenSize <= 22 ? '22-inch' : screenSize <= 24.9 ? '24-inch' : screenSize <= 27.9 ? '27-inch' : screenSize <= 31.9 ? '32-inch' : '34-inch-plus')
    }
    const resolution = attrMap.resolution ?? ''
    if (/3840|4k|uhd/.test(resolution)) tags.push('4k')
    else if (/2560|1440|qhd|2k/.test(resolution)) tags.push('2k')
    else if (/1920|1080|fhd/.test(resolution)) tags.push('full-hd')

    const panel = attrMap.panel_type ?? ''
    if (panel.includes('oled')) tags.push('oled')
    else if (panel.includes('ips')) tags.push('ips')
    else if (panel.includes('va')) tags.push('va')
    else if (panel.includes('tn')) tags.push('tn')

    const hz = Number.parseInt(attrMap.refresh_rate ?? '0', 10)
    if (hz >= 240) tags.push('240hz')
    else if (hz >= 165) tags.push('165hz')
    else if (hz >= 144) tags.push('144hz')
    else if (hz >= 100) tags.push('100hz')
    else if (hz >= 60) tags.push('60hz')

    if (/nitro|predator|gaming|game/.test(text)) tags.push('gaming')
    else if (/vero|eco|sustainable/.test(text)) tags.push('eco')
    else if (/design|creative|color-accurate/.test(text)) tags.push('creative')
    else if (/portable|dual-screen/.test(text)) tags.push('portable')
    else tags.push('office')
  }

  if (category === 'laptops') {
    const screenSize = parseFloat(attrMap.screen_size ?? '')
    if (!Number.isNaN(screenSize)) {
      tags.push(screenSize <= 13.5 ? '13-inch' : screenSize <= 14.5 ? '14-inch' : screenSize <= 15.9 ? '15-inch' : screenSize <= 16.5 ? '16-inch' : '17-inch')
    }
    const cpu = attrMap.processor_model ?? ''
    if (/core.{0,4}i9|ultra.{0,4}9/.test(cpu)) tags.push('intel-i9')
    else if (/core.{0,4}i7|ultra.{0,4}7/.test(cpu)) tags.push('intel-i7')
    else if (/core.{0,4}i5|ultra.{0,4}5/.test(cpu)) tags.push('intel-i5')
    else if (/core.{0,4}i3/.test(cpu)) tags.push('intel-i3')
    else if (/ryzen.{0,4}9/.test(cpu)) tags.push('amd-ryzen-9')
    else if (/ryzen.{0,4}7/.test(cpu)) tags.push('amd-ryzen-7')
    else if (/ryzen.{0,4}5/.test(cpu)) tags.push('amd-ryzen-5')
    else if (/ryzen.{0,4}3/.test(cpu)) tags.push('amd-ryzen-3')
    else if (/celeron/.test(cpu)) tags.push('intel-celeron')
    else if (/pentium/.test(cpu)) tags.push('intel-pentium')

    const ram = Number.parseInt((attrMap.ram ?? '').match(/(\d+)/)?.[1] ?? '0', 10)
    if (ram >= 32) tags.push('32gb-ram')
    else if (ram >= 16) tags.push('16gb-ram')
    else if (ram >= 8) tags.push('8gb-ram')
    else if (ram > 0) tags.push('4gb-ram')

    const storageMatch = (attrMap.storage ?? '').match(/(\d+(?:\.\d+)?)\s*(gb|tb)/i)
    if (storageMatch) {
      const totalGb = storageMatch[2].toLowerCase() === 'tb' ? Number.parseFloat(storageMatch[1]) * 1000 : Number.parseFloat(storageMatch[1])
      tags.push(totalGb >= 1000 ? '1tb-ssd' : totalGb >= 512 ? '512gb-ssd' : totalGb >= 256 ? '256gb-ssd' : '128gb-ssd')
    }

    if (attrMap.keyboard_layout) tags.push(attrMap.keyboard_layout)

    if (/nitro|predator|gaming|game/.test(text)) tags.push('gaming')
    else if (/spin|convertible|2.in.1|2-in-1/.test(text)) tags.push('2-in-1')
    else if (/chromebook/.test(text)) tags.push('chromebook')
    else if (/swift|ultrathin|slim|ultra/.test(text)) tags.push('ultrabook')
    else if (/vero|eco/.test(text)) tags.push('eco')
    else tags.push('everyday')
  }

  return [...new Set(tags)].slice(0, 6)
}

function translateExistingTags(rawTags: string | null): string[] | undefined {
  if (!rawTags) return undefined
  try {
    const parsed = JSON.parse(rawTags)
    if (!Array.isArray(parsed)) return undefined
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => NON_EN_COLORS[value] ? NON_EN_COLORS[value].toLowerCase() : value)
      .slice(0, 10)
  } catch {
    return undefined
  }
}

function productsEqual(a: ProductUpdate, current: ProductRow): boolean {
  const currentTags = translateExistingTags(current.tags) ?? []
  const nextTags = a.tags ?? currentTags
  return (a.title ?? current.title) === current.title
    && (a.description ?? current.description ?? null) === (current.description ?? null)
    && JSON.stringify(nextTags) === JSON.stringify(currentTags)
}

async function queryD1<T>(token: string, sql: string): Promise<T[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  })
  const json = await response.json() as {
    success: boolean
    errors?: Array<{ message: string }>
    result?: Array<{ results: T[] }>
  }
  if (!json.success) {
    throw new Error(json.errors?.map((err) => err.message).join('; ') ?? 'D1 query failed')
  }
  return json.result?.[0]?.results ?? []
}

async function fetchEnglishSearchHit(sku: string): Promise<EnglishSearchHit> {
  const cached = SEARCH_CACHE.get(sku)
  if (cached) return cached

  const job = (async (): Promise<EnglishSearchHit> => {
    const searchUrl = `https://store.acer.com/en-ie/catalogsearch/result/?q=${encodeURIComponent(sku)}`
    const response = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!response.ok) return { title: null }
    const html = await response.text()
    const regex = /<a class="product-item-link"[\s\S]*?href="[^"]+"[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?<div class="sku-wrapper">[\s\S]*?<span>\s*([^<]+)\s*<\/span>/gi
    for (const match of html.matchAll(regex)) {
      const title = cleanWhitespace(match[1].replace(/<[^>]+>/g, ''))
      const foundSku = cleanWhitespace(match[2])
      if (foundSku === sku) return { title }
    }
    return { title: null }
  })()

  SEARCH_CACHE.set(sku, job)
  return job
}

async function apiPatchProduct(baseUrl: string, headers: HeadersInit, sku: string, update: ProductUpdate): Promise<void> {
  const response = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/local`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      fields: {
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.description !== undefined ? { description: update.description } : {}),
        ...(update.tags !== undefined ? { tags: update.tags } : {}),
      },
      triggeredBy: 'agent',
    }),
  })
  if (!response.ok) {
    throw new Error(`PATCH product ${sku} failed: ${response.status} ${await response.text()}`)
  }
}

async function apiPutAttributes(baseUrl: string, headers: HeadersInit, sku: string, attributes: AttributeUpdate[]): Promise<void> {
  const response = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/attributes`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      mode: 'merge',
      attributes,
      triggeredBy: 'agent',
    }),
  })
  if (!response.ok) {
    throw new Error(`PUT attributes ${sku} failed: ${response.status} ${await response.text()}`)
  }
}

async function runConcurrent<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const queue = new Set<Promise<void>>()
  let index = 0
  for (const item of items) {
    const promise = fn(item, index).finally(() => queue.delete(promise))
    queue.add(promise)
    index += 1
    if (queue.size >= limit) {
      await Promise.race(queue)
    }
  }
  await Promise.all(queue)
}

async function main(): Promise<void> {
  const vars = parseEnv(await readFile('.dev.vars', 'utf8'))
  const cloudflareToken = pickEnv('CLOUDFLARE_API_TOKEN', vars)
  const baseUrl = pickEnv('WIZHARD_URL', vars)
  const agentToken = pickEnv('AGENT_BEARER_TOKEN', vars)
  const accessId = pickEnv('CF_ACCESS_CLIENT_ID', vars)
  const accessSecret = pickEnv('CF_ACCESS_CLIENT_SECRET', vars)

  const apiHeaders: HeadersInit = {
    Authorization: `Bearer ${agentToken}`,
    'CF-Access-Client-Id': accessId,
    'CF-Access-Client-Secret': accessSecret,
  }

  log(`Loading products from production D1${DRY_RUN ? ' [dry-run]' : ''}${ONLY_SKU ? ` sku=${ONLY_SKU}` : ''}`)

  const products = await queryD1<ProductRow>(cloudflareToken, `
    SELECT
      p.id,
      p.title,
      p.description,
      p.tags,
      p.status,
      ws.source_url AS sourceUrl,
      ws.source_name AS sourceName
    FROM products p
    LEFT JOIN warehouse_stock ws
      ON ws.product_id = p.id
     AND ws.warehouse_id = 'acer_store'
    ${ONLY_SKU ? `WHERE p.id = '${ONLY_SKU.replace(/'/g, "''")}'` : ''}
    ORDER BY p.id;
  `)

  const attrs = await queryD1<AttributeRow>(cloudflareToken, `
    SELECT
      product_id AS productId,
      key,
      value,
      type
    FROM product_metafields
    WHERE namespace = 'attributes'
    ${ONLY_SKU ? `AND product_id = '${ONLY_SKU.replace(/'/g, "''")}'` : ''}
    ORDER BY product_id, key;
  `)

  const attrsByProduct = new Map<string, AttributeRow[]>()
  for (const row of attrs) {
    const bucket = attrsByProduct.get(row.productId) ?? []
    bucket.push(row)
    attrsByProduct.set(row.productId, bucket)
  }

  const selected = LIMIT ? products.slice(0, LIMIT) : products
  const stats = { scanned: 0, changedProducts: 0, changedAttributes: 0, skipped: 0, failed: 0 }

  await runConcurrent(selected, CONCURRENCY, async (product, index) => {
    stats.scanned += 1
    const locale = product.sourceUrl ? detectFullLocale(product.sourceUrl) : null
    const category = detectCategory(product.sourceName ?? product.title, product.sourceUrl ?? '')
    const englishSearch = locale && locale !== 'en-ie' ? await fetchEnglishSearchHit(product.id) : { title: null }

    const nextTitle = normalizeText(englishSearch.title ?? translateFreeText(product.title))
    const nextDescription = product.description ? normalizeText(translateFreeText(product.description)) : null

    const translatedAttrs = (attrsByProduct.get(product.id) ?? []).map((attr) => ({
      key: attr.key,
      value: attr.value === null ? null : normalizeSpecValue(attr.key, attr.value),
      type: attr.type ?? 'single_line_text_field',
    }))

    if (category === 'laptops' && product.sourceUrl) {
      const layout = detectKeyboardLayout(product.sourceUrl)
      if (layout && !translatedAttrs.some((attr) => attr.key === 'keyboard_layout')) {
        translatedAttrs.push({ key: 'keyboard_layout', value: layout, type: 'single_line_text_field' })
      }
    }

    const generatedTags = (category === 'monitor' || category === 'laptops')
      ? generateTags(
          category,
          translatedAttrs.filter((attr): attr is { key: string; value: string; type: string } => typeof attr.value === 'string' && attr.value.length > 0),
          nextTitle,
          nextDescription,
        )
      : (translateExistingTags(product.tags) ?? undefined)

    const productUpdate: ProductUpdate = {
      title: nextTitle,
      description: nextDescription,
      ...(generatedTags ? { tags: generatedTags } : {}),
    }

    const attrChanged = JSON.stringify(translatedAttrs.map((attr) => [attr.key, attr.value])) !== JSON.stringify(
      (attrsByProduct.get(product.id) ?? []).map((attr) => [attr.key, attr.value]),
    )
    const productChanged = FORCE || !productsEqual(productUpdate, product)

    if (!productChanged && !attrChanged) {
      stats.skipped += 1
      if (index % 25 === 0) log(`skip ${product.id} (${index + 1}/${selected.length})`)
      return
    }

    try {
      if (DRY_RUN) {
        log(`dry-run ${product.id} locale=${locale ?? 'unknown'} category=${category} productChanged=${productChanged} attrChanged=${attrChanged}`)
        if (productChanged) {
          log(`  title: ${product.title} => ${nextTitle}`)
        }
      } else {
        if (productChanged) {
          await apiPatchProduct(baseUrl, apiHeaders, product.id, productUpdate)
          stats.changedProducts += 1
        }
        if (attrChanged) {
          await apiPutAttributes(baseUrl, apiHeaders, product.id, translatedAttrs)
          stats.changedAttributes += 1
        }
        log(`updated ${product.id} (${index + 1}/${selected.length})`)
      }
    } catch (error) {
      stats.failed += 1
      log(`ERROR ${product.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  log(`Done. scanned=${stats.scanned} changedProducts=${stats.changedProducts} changedAttributes=${stats.changedAttributes} skipped=${stats.skipped} failed=${stats.failed}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
