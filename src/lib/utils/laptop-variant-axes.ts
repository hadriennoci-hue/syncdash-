function normalizeAscii(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

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

const COLOR_MAP: Record<string, string> = {
  black: 'Black',
  noir: 'Black',
  schwarz: 'Black',
  zwart: 'Black',
  nero: 'Black',
  negro: 'Black',
  czarny: 'Black',
  sort: 'Black',
  musta: 'Black',
  silver: 'Silver',
  argent: 'Silver',
  argento: 'Silver',
  zilver: 'Silver',
  silber: 'Silver',
  hopea: 'Silver',
  solv: 'Silver',
  solva: 'Silver',
  gray: 'Gray',
  grey: 'Gray',
  gris: 'Gray',
  grau: 'Gray',
  grijs: 'Gray',
  harmaa: 'Gray',
  gra: 'Gray',
  szary: 'Gray',
  grigio: 'Gray',
  white: 'White',
  blanc: 'White',
  weiss: 'White',
  wit: 'White',
  valkoinen: 'White',
  hvid: 'White',
  hvit: 'White',
  vit: 'White',
  bialy: 'White',
  bianco: 'White',
  blanco: 'White',
  blue: 'Blue',
  bleu: 'Blue',
  blau: 'Blue',
  blauw: 'Blue',
  sininen: 'Blue',
  bla: 'Blue',
  niebieski: 'Blue',
  blu: 'Blue',
  azul: 'Blue',
  red: 'Red',
  rouge: 'Red',
  rot: 'Red',
  rood: 'Red',
  punainen: 'Red',
  rod: 'Red',
  czerwony: 'Red',
  rosso: 'Red',
  rojo: 'Red',
  gold: 'Gold',
  goud: 'Gold',
  kulta: 'Gold',
  guld: 'Gold',
  zloty: 'Gold',
  oro: 'Gold',
  green: 'Green',
  vert: 'Green',
  grun: 'Green',
  groen: 'Green',
  vihrea: 'Green',
  zielony: 'Green',
  verde: 'Green',
}

export function detectFullLocale(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null
  const match = sourceUrl.match(/store\.acer\.com\/([a-z]{2}-[a-z]{2})\//i)
  return match?.[1]?.toLowerCase() ?? null
}

export function detectKeyboardLayoutFromSource(sourceUrl: string | null | undefined): string | null {
  const locale = detectFullLocale(sourceUrl)
  return locale ? (KEYBOARD_LAYOUT_BY_LOCALE[locale] ?? null) : null
}

function tokenizeText(input: string): string[] {
  return normalizeAscii(input)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function normalizeColorValue(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = normalizeAscii(raw).trim()
  if (!normalized) return null
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized]

  const parts = normalized.split(/[/-]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    const translated = parts.map((part) => COLOR_MAP[part] ?? null)
    if (translated.every(Boolean)) return translated.join(' / ')
  }

  return null
}

export function detectColorFromSource(...inputs: Array<string | null | undefined>): string | null {
  for (const input of inputs) {
    if (!input) continue
    const direct = normalizeColorValue(input)
    if (direct) return direct

    const tokens = tokenizeText(input)
    const hit = tokens.find((token) => COLOR_MAP[token])
    if (hit) return COLOR_MAP[hit]
  }
  return null
}

export function deriveLaptopVariantAxes(input: {
  sourceUrl?: string | null
  sourceName?: string | null
  title?: string | null
  keyboardLayout?: string | null
  color?: string | null
}): { keyboardLayout: string | null; color: string | null } {
  const keyboardLayout =
    input.keyboardLayout?.trim()
    || detectKeyboardLayoutFromSource(input.sourceUrl)
    || null

  const color =
    normalizeColorValue(input.color)
    || detectColorFromSource(input.sourceName, input.title, input.sourceUrl)
    || null

  return { keyboardLayout, color }
}
