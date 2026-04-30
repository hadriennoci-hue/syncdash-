export type ProductCollectionSlug =
  | 'laptops'
  | 'displays'
  | 'tablets'
  | 'desktops'
  | 'audio'
  | 'gpu'
  | 'input-devices'
  | 'cases'
  | 'lifestyle'
  | 'accessories'
  | 'gaming-desks'
  | 'electric-scooters'

interface InferProductCollectionInput {
  title?: string | null
  sourceName?: string | null
  sourceUrl?: string | null
  price?: number | null
}

interface InferProductCollectionResult {
  slug: ProductCollectionSlug
  reason: string
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeText(part ?? ''))
    .filter((part, index, all) => part.length > 0 && all.indexOf(part) === index)
    .join(' ')
}

const DISPLAY_KEYWORDS = [
  'monitor', 'display', 'screen', 'ecran', 'scherm', 'schermo', 'skjerm', 'nayt', 'visioncare',
]

const CASE_KEYWORDS = [
  'carrying case', 'protective sleeve', 'sleeve', 'backpack', 'rucksack', 'bag', 'bags',
  'carrying bag', 'luggage', 'carry case', 'case', 'funda', 'funda protectora', 'maletin',
  'housse', 'sacoche', 'tasche', 'etui', 'cover', 'pouch',
]

const AUDIO_KEYWORDS = [
  'headset', 'headphone', 'headphones', 'earbud', 'earbuds', 'earphone', 'earphones',
  'soundbar', 'speaker', 'speakers', 'galea', 'casque', 'ecouteur', 'enceinte',
]

const INPUT_DEVICE_KEYWORDS = [
  'mouse', 'mice', 'keyboard', 'keyboards', 'mousepad', 'mouse pad', 'controller',
  'controllers', 'gamepad', 'joystick', 'stylus', 'active stylus', 'trackpad', 'remote control',
]

const DESKTOP_KEYWORDS = [
  'desktop', 'desktops', 'all-in-one', 'all in one', 'aio', 'veriton', 'chromebox',
  'mini pc', 'tower', 'workstation', 'aspire c', 'aspire tc', 'aspire xc',
]

const TABLET_KEYWORDS = [
  'tablet', 'tablette', 'tableta', ' tab ',
]

const GPU_KEYWORDS = [
  'graphics card', 'graphic card', 'gpu', 'geforce rtx', 'radeon rx', 'carte graphique', 'grafikkarte',
]

const LIFESTYLE_KEYWORDS = [
  'dongle', '5g dongle', 'portable 5g', 'hotspot', 'router', 'connect d5',
  'lifestyle', 'wearable', 'smart ring', 'portable projector',
  'desk', 'gaming desk', 'standing desk', 'scooter', 'electric scooter', 'e-scooter',
]

const DESK_KEYWORDS = ['desk', 'gaming desk', 'standing desk']
const SCOOTER_KEYWORDS = ['scooter', 'electric scooter', 'e-scooter']
const STYLUS_KEYWORDS = ['stylus', 'active stylus', 'digital pen', 'pen']

const LAPTOP_KEYWORDS = [
  'laptop', 'laptops', 'notebook', 'notebooks', 'ordinateur portable', 'ordinateurs portables',
  'portable computer', 'portable pc', 'ultrabook', 'chromebook', 'travelmate',
  'swift', 'aspire', 'predator', 'nitro', 'convertible', '2-in-1', '2 in 1',
]

const ACCESSORY_BLOCKERS = [
  ...CASE_KEYWORDS,
  ...AUDIO_KEYWORDS,
  ...INPUT_DEVICE_KEYWORDS,
  ...LIFESTYLE_KEYWORDS,
]

export function inferProductCollection(input: InferProductCollectionInput): InferProductCollectionResult | null {
  const price = typeof input.price === 'number' && Number.isFinite(input.price) ? input.price : null
  const text = joinParts([input.title, input.sourceName, input.sourceUrl])
  if (!text) return null

  if (hasAny(text, CASE_KEYWORDS)) return { slug: 'cases', reason: 'case_keywords' }
  if (hasAny(text, AUDIO_KEYWORDS)) return { slug: 'audio', reason: 'audio_keywords' }
  if (hasAny(text, INPUT_DEVICE_KEYWORDS)) return { slug: 'input-devices', reason: 'input_keywords' }
  if (hasAny(text, DESKTOP_KEYWORDS)) return { slug: 'desktops', reason: 'desktop_keywords' }
  if (hasAny(text, DISPLAY_KEYWORDS)) return { slug: 'displays', reason: 'display_keywords' }
  if (hasAny(text, TABLET_KEYWORDS)) return { slug: 'tablets', reason: 'tablet_keywords' }
  if (hasAny(text, GPU_KEYWORDS)) return { slug: 'gpu', reason: 'gpu_keywords' }
  if (hasAny(text, DESK_KEYWORDS)) return { slug: 'gaming-desks', reason: 'desk_keywords' }
  if (hasAny(text, SCOOTER_KEYWORDS)) return { slug: 'electric-scooters', reason: 'scooter_keywords' }
  if (hasAny(text, STYLUS_KEYWORDS)) return { slug: 'accessories', reason: 'stylus_keywords' }
  if (hasAny(text, LIFESTYLE_KEYWORDS)) return { slug: 'lifestyle', reason: 'lifestyle_keywords' }

  if (hasAny(text, LAPTOP_KEYWORDS)) {
    if (hasAny(text, ACCESSORY_BLOCKERS)) {
      return { slug: 'lifestyle', reason: 'laptop_accessory_override' }
    }
    if (price != null && price < 100) {
      return { slug: 'lifestyle', reason: 'low_price_laptop_guard' }
    }
    return { slug: 'laptops', reason: 'laptop_keywords' }
  }

  return { slug: 'lifestyle', reason: 'default_lifestyle' }
}
