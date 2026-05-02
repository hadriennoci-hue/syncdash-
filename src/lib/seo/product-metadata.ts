import { cleanTextArtifacts } from '@/lib/utils/description'

export type SeoFamily =
  | 'laptop'
  | 'monitor'
  | 'desktop'
  | 'projector'
  | 'graphics_card'
  | 'storage'
  | 'laptop_bag'
  | 'audio'
  | 'webcam'
  | 'controller'
  | 'docking_station'
  | 'connectivity'
  | 'camera'
  | 'electric_scooter'
  | 'keyboard'
  | 'mouse'
  | 'headset'
  | 'gaming_chair'
  | 'gaming_desk'
  | 'tablet'
  | 'ai_workstation'
  | 'gaming_console'
  | 'accessory'
  | 'unknown'

export interface SeoMetafield {
  namespace: string
  key: string
  value: string | null
}

export interface SeoTranslationRow {
  locale: string
  title: string | null
  description: string | null
  metaTitle: string | null
  metaDescription: string | null
}

export interface SeoProductSource {
  id: string
  title: string
  description: string | null
  metaDescription: string | null
  collections: Array<{ slug: string | null; name: string }>
  metafields: SeoMetafield[]
  translations: SeoTranslationRow[]
}

export interface SeoDraft {
  family: SeoFamily
  weakFit: boolean
  baseMetaDescription: string | null
  signals: string[]
}

const WEAK_FIT_FAMILIES = new Set<SeoFamily>([
  'tablet',
  'gaming_chair',
  'gaming_desk',
  'accessory',
  'unknown',
])

function normalizeText(input: string | null | undefined): string | null {
  const cleaned = cleanTextArtifacts(input)
  if (!cleaned) return null
  return cleaned
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim() || null
}

function truncateAtWordBoundary(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= limit) return normalized
  const cut = normalized.slice(0, limit + 1)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > 40 ? cut.slice(0, boundary) : normalized.slice(0, limit)).trim()}`
}

export function normalizeSeoTitle(value: string | null | undefined, maxLength = 70): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  return truncateAtWordBoundary(normalized, maxLength)
}

export function normalizeSeoDescription(value: string | null | undefined, maxLength = 160): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  return truncateAtWordBoundary(normalized, maxLength)
}

export function getAttributeMap(product: SeoProductSource): Map<string, string> {
  return new Map(
    product.metafields
      .filter((field) => field.namespace === 'attributes')
      .map((field) => [field.key.trim().toLowerCase(), field.value?.trim() ?? ''])
  )
}

function pickAttribute(attributes: Map<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeText(attributes.get(key.toLowerCase()))
    if (value) return value
  }
  return null
}

export function getSeoFamily(product: SeoProductSource): SeoFamily {
  const slug = product.collections[0]?.slug?.toLowerCase() ?? ''

  if (['laptops', 'gaming-laptops', 'work-laptops'].includes(slug)) return 'laptop'
  if (['monitors', 'gaming-monitors', 'ultrawide-monitors', 'foldable-monitors'].includes(slug)) return 'monitor'
  if (['desktops', 'gaming-desktops'].includes(slug)) return 'desktop'
  if (slug === 'projectors') return 'projector'
  if (slug === 'graphics-cards') return 'graphics_card'
  if (slug === 'storage') return 'storage'
  if (slug === 'laptop-bags') return 'laptop_bag'
  if (slug === 'audio') return 'audio'
  if (slug === 'webcams') return 'webcam'
  if (slug === 'controllers') return 'controller'
  if (slug === 'docking-stations') return 'docking_station'
  if (slug === 'connectivity') return 'connectivity'
  if (slug === 'cameras') return 'camera'
  if (slug === 'electric-scooters') return 'electric_scooter'
  if (slug === 'keyboards') return 'keyboard'
  if (slug === 'mice') return 'mouse'
  if (slug === 'headsets-earbuds' || slug === 'headsets') return 'headset'
  if (slug === 'gaming-chairs') return 'gaming_chair'
  if (slug === 'gaming-desks') return 'gaming_desk'
  if (slug === 'tablets') return 'tablet'
  if (slug === 'ai-workstations') return 'ai_workstation'
  if (slug === 'gaming-consoles') return 'gaming_console'
  if (slug === 'accessories') return 'accessory'
  return 'unknown'
}

function shortPitchFromMetafields(product: SeoProductSource): string | null {
  for (const field of product.metafields) {
    const key = `${field.namespace}.${field.key}`.toLowerCase()
    if (key.endsWith('.short_pitch') || field.key.toLowerCase() === 'short_pitch') {
      const value = normalizeText(field.value)
      if (value) return value
    }
  }
  return null
}

function joinParts(parts: Array<string | null | undefined>, separator = ', '): string | null {
  const values = parts.map((part) => normalizeText(part)).filter((part): part is string => Boolean(part))
  return values.length > 0 ? values.join(separator) : null
}

function buildLaptopDescription(attributes: Map<string, string>): string | null {
  const screen = pickAttribute(attributes, 'screen_size', 'screen', 'display_size')
  const resolution = pickAttribute(attributes, 'resolution', 'screen_resolution')
  const panel = pickAttribute(attributes, 'panel_type', 'screen_type')
  const touchscreen = pickAttribute(attributes, 'touchscreen')
  const cpu = pickAttribute(attributes, 'processor_model', 'processor', 'processor_brand')
  const ram = pickAttribute(attributes, 'ram', 'memory')
  const storage = pickAttribute(attributes, 'storage', 'ssd', 'ssd_capacity')
  const os = pickAttribute(attributes, 'operating_system', 'os')
  const gpu = pickAttribute(attributes, 'gpu', 'graphics', 'graphics_card')

  const opening = joinParts([
    screen ? `${screen}` : null,
    resolution,
    panel,
  ], ' ')

  const specs = joinParts([
    cpu,
    ram,
    storage,
    os,
    gpu && !/shared memory/i.test(gpu) ? gpu : null,
  ])

  if (!opening || !specs) return null
  const tail = touchscreen ? 'touchscreen' : null
  return normalizeText([
    `${opening} laptop with ${specs}`,
    tail ? `(${tail})` : null,
  ].filter(Boolean).join(' ')) || null
}

function buildMonitorDescription(attributes: Map<string, string>): string | null {
  const screen = pickAttribute(attributes, 'screen_size', 'screen')
  const resolution = pickAttribute(attributes, 'resolution', 'screen_resolution')
  const refresh = pickAttribute(attributes, 'refresh_rate')
  const panel = pickAttribute(attributes, 'panel_type', 'screen_type')
  const curved = pickAttribute(attributes, 'curved')
  const hdr = pickAttribute(attributes, 'hdr')
  const ports = pickAttribute(attributes, 'ports')
  const responseTime = pickAttribute(attributes, 'response_time')

  const opening = joinParts([
    screen ? `${screen} monitor` : null,
    resolution,
  ], ' ')

  const specs = joinParts([
    refresh ? `${refresh} refresh` : null,
    panel,
    curved && /yes/i.test(curved) ? 'curved' : null,
    hdr && /yes|hdr/i.test(hdr) ? 'HDR' : null,
    responseTime ? `${responseTime} response` : null,
    ports ? ports.split(/[,/]/).map((part) => part.trim()).filter(Boolean).slice(0, 3).join(', ') : null,
  ])

  if (!opening || !specs) return null
  return normalizeText(`${opening} with ${specs}`) || null
}

function buildGenericDescription(family: SeoFamily, attributes: Map<string, string>): string | null {
  switch (family) {
    case 'desktop':
      return normalizeText([
        pickAttribute(attributes, 'processor_model', 'processor', 'cpu'),
        pickAttribute(attributes, 'ram', 'memory'),
        pickAttribute(attributes, 'storage', 'ssd'),
        pickAttribute(attributes, 'gpu', 'graphics'),
      ].filter(Boolean).join(', ')) || null
    case 'projector':
      return joinParts([
        pickAttribute(attributes, 'resolution'),
        pickAttribute(attributes, 'brightness'),
        pickAttribute(attributes, 'contrast_ratio'),
        pickAttribute(attributes, 'aspect_ratio'),
      ])
    case 'graphics_card':
      return joinParts([
        pickAttribute(attributes, 'gpu_model', 'gpu'),
        pickAttribute(attributes, 'memory'),
        pickAttribute(attributes, 'architecture'),
      ])
    case 'storage':
      return joinParts([
        pickAttribute(attributes, 'capacity', 'storage'),
        pickAttribute(attributes, 'interface'),
        pickAttribute(attributes, 'read_speed'),
        pickAttribute(attributes, 'write_speed'),
      ])
    case 'laptop_bag':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'laptop_size'),
        pickAttribute(attributes, 'capacity'),
        pickAttribute(attributes, 'material'),
      ])
    case 'audio':
    case 'headset':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'connection'),
        pickAttribute(attributes, 'driver_size'),
        pickAttribute(attributes, 'microphone'),
      ])
    case 'webcam':
      return joinParts([
        pickAttribute(attributes, 'resolution'),
        pickAttribute(attributes, 'frame_rate'),
        pickAttribute(attributes, 'field_of_view'),
      ])
    case 'controller':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'connection'),
        pickAttribute(attributes, 'platform_compatibility'),
      ])
    case 'docking_station':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'host_connection'),
        pickAttribute(attributes, 'video_outputs'),
        pickAttribute(attributes, 'usb_ports'),
      ])
    case 'connectivity':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'wireless_standard'),
        pickAttribute(attributes, 'cellular'),
        pickAttribute(attributes, 'max_speed'),
      ])
    case 'camera':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'resolution'),
        pickAttribute(attributes, 'focus'),
        pickAttribute(attributes, 'stabilization'),
      ])
    case 'electric_scooter':
      return joinParts([
        pickAttribute(attributes, 'product_subtype'),
        pickAttribute(attributes, 'speed'),
        pickAttribute(attributes, 'range'),
        pickAttribute(attributes, 'motor'),
      ])
    case 'keyboard':
      return joinParts([
        pickAttribute(attributes, 'layout'),
        pickAttribute(attributes, 'switch_type'),
        pickAttribute(attributes, 'connection'),
      ])
    case 'mouse':
      return joinParts([
        pickAttribute(attributes, 'dpi'),
        pickAttribute(attributes, 'buttons'),
        pickAttribute(attributes, 'connection'),
      ])
    case 'gaming_chair':
      return joinParts([
        pickAttribute(attributes, 'backrest'),
        pickAttribute(attributes, 'armrests'),
        pickAttribute(attributes, 'pillows'),
      ])
    case 'gaming_desk':
      return joinParts([
        pickAttribute(attributes, 'lighting'),
        pickAttribute(attributes, 'features'),
      ])
    case 'tablet':
      return joinParts([
        pickAttribute(attributes, 'screen_size'),
        pickAttribute(attributes, 'resolution'),
        pickAttribute(attributes, 'processor_model', 'processor'),
        pickAttribute(attributes, 'ram'),
        pickAttribute(attributes, 'storage'),
      ])
    case 'ai_workstation':
      return joinParts([
        pickAttribute(attributes, 'processor_model', 'processor'),
        pickAttribute(attributes, 'ram'),
        pickAttribute(attributes, 'storage'),
        pickAttribute(attributes, 'ai_performance'),
      ])
    case 'gaming_console':
      return joinParts([
        pickAttribute(attributes, 'screen_size'),
        pickAttribute(attributes, 'processor_model', 'processor'),
        pickAttribute(attributes, 'ram'),
        pickAttribute(attributes, 'storage'),
      ])
    case 'accessory':
    case 'unknown':
    default:
      return null
  }
}

export function buildBaseSeoDraft(product: SeoProductSource): SeoDraft {
  const family = getSeoFamily(product)
  const attributes = getAttributeMap(product)
  const signals: string[] = []

  const shortPitch = shortPitchFromMetafields(product)
  if (shortPitch) signals.push('short_pitch')

  let baseMetaDescription =
    (family === 'laptop' ? normalizeSeoDescription(buildLaptopDescription(attributes)) : null) ??
    (family === 'monitor' ? normalizeSeoDescription(buildMonitorDescription(attributes)) : null) ??
    normalizeSeoDescription(buildGenericDescription(family, attributes)) ??
    normalizeSeoDescription(shortPitch)

  if (!baseMetaDescription && product.description) {
    baseMetaDescription = normalizeSeoDescription(
      product.description
        .split(/\n+/)
        .map((line) => line.trim())
        .find(Boolean)
    )
    if (baseMetaDescription) signals.push('description_fallback')
  }

  if (!baseMetaDescription) signals.push('needs_ai')
  if (family === 'unknown' || WEAK_FIT_FAMILIES.has(family)) signals.push('weak_fit')

  return {
    family,
    weakFit: family === 'unknown' || WEAK_FIT_FAMILIES.has(family),
    baseMetaDescription,
    signals,
  }
}

export function buildLocaleMetaTitle(localeTitle: string | null | undefined, baseTitle: string): string | null {
  return normalizeSeoTitle(localeTitle ?? baseTitle)
}

export function compactLocaleMetaDescription(localeDescription: string | null | undefined): string | null {
  const normalized = normalizeText(localeDescription)
  if (!normalized) return null

  const sentence = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find(Boolean)

  return normalizeSeoDescription(sentence ?? normalized)
}

export function buildSeoPromptContext(product: SeoProductSource): string {
  const attributes = getAttributeMap(product)
  const interesting = Array.from(attributes.entries())
    .filter(([, value]) => Boolean(value))
    .slice(0, 18)
    .map(([key, value]) => `${key}: ${value}`)
  const base = [
    `SKU: ${product.id}`,
    `Title: ${product.title}`,
    product.description ? `Description: ${normalizeText(product.description)}` : null,
    product.metaDescription ? `Base meta description: ${normalizeText(product.metaDescription)}` : null,
    interesting.length > 0 ? `Attributes:\n${interesting.join('\n')}` : null,
  ].filter(Boolean)

  return base.join('\n')
}

export function buildGoogleQuery(product: SeoProductSource): string {
  const collection = product.collections[0]?.slug?.replace(/-/g, ' ') ?? ''
  const terms = [product.title, product.id, collection].filter(Boolean).join(' ')
  return `site:acer.com OR site:store.acer.com ${terms}`
}
