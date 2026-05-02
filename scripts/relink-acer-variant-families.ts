import { randomUUID } from 'crypto'

type ProductSummary = {
  id: string
  title: string
  supplier: { id: string; name: string } | null
  variantGroupId: string | null
}

type ProductDetail = {
  id: string
  title: string
  description: string | null
  variantGroupId: string | null
  collections: Array<{ slug: string | null; id: string; name: string }>
  metafields: Array<{ namespace: string; key: string; value: string | null }>
  acerStoreSourceUrl: string | null
  acerStoreSourceName: string | null
}

type AttrRow = { key: string; value: string | null }

type Candidate = {
  id: string
  title: string
  description: string | null
  variantGroupId: string | null
  categories: Array<{ slug: string | null; categoryId: string }>
  metafields: AttrRow[]
  warehouseStock: Array<{ warehouseId: string; sourceUrl: string | null; sourceName: string | null }>
}

const BASE = process.env.WIZHARD_URL ?? 'https://wizhard.store'
const ACCESS_TOKEN = process.env.AGENT_BEARER_TOKEN ?? ''
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? ''
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? ''
const TARGET_SLUGS = new Set(['laptops', 'work-laptops', 'gaming-laptops', 'input-devices'])
const LAPTOP_COLLECTION_SLUGS = new Set(['laptops', 'work-laptops', 'gaming-laptops'])
const EXCLUDE_TITLE_WORDS = [
  'monitor', 'mouse', 'controller', 'desk', 'bag', 'scooter', 'projector', 'dock', 'charger',
  'headset', 'earbud', 'stylus', 'keyboard', 'speaker', 'pen', 'printer', 'router', 'webcam',
  'camera', 'case', 'hub', 'adapter', 'dongle', 'all-in-one', 'desktop', 'stand', 'mousepad',
  'accessorie', 'chair', 'keyboard', 'gamepad', 'card reader', 'cardreader', 'mice',
]

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
    'Content-Type': 'application/json',
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data?: T }
  return (json.data ?? json) as T
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`)
  const json = await res.json() as { data?: T }
  return (json.data ?? json) as T
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function stripTrailingLaptopColor(title: string): string {
  const normalized = normalizeWhitespace(title)
  for (const color of ['Black', 'White', 'Silver', 'Gray', 'Grey', 'Blue', 'Red', 'Green', 'Gold', 'Pink']) {
    const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\s*\\|\\s*${escaped}$`, 'i')
    if (regex.test(normalized)) {
      return normalizeWhitespace(normalized.replace(regex, ''))
    }
  }
  return normalized
}

function normalizeFamilyTitle(title: string, collectionSlug: 'laptops' | 'input-devices' | null): string {
  if (collectionSlug === 'laptops') return stripTrailingLaptopColor(title)
  return normalizeWhitespace(title)
}

function toAttrMap(rows: AttrRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const key = row.key.trim().toLowerCase()
    const value = (row.value ?? '').trim()
    if (!key || !value) continue
    map.set(key, value)
  }
  return map
}

function comparableAttrs(map: Map<string, string>, collectionSlug: string): Map<string, string> {
  const comparable = new Map<string, string>()
  for (const [key, value] of map.entries()) {
    if (collectionSlug === 'laptops' && (key === 'keyboard_layout' || key === 'color')) continue
    if (collectionSlug === 'input-devices' && key === 'keyboard_layout') continue
    comparable.set(key, value)
  }
  return comparable
}

function getVariantCollection(slugs: Set<string>): 'laptops' | 'input-devices' | null {
  if ([...LAPTOP_COLLECTION_SLUGS].some((slug) => slugs.has(slug))) return 'laptops'
  if (slugs.has('input-devices')) return 'input-devices'
  return null
}

function extractLaptopModelKey(input: string | null | undefined): string | null {
  if (!input) return null
  const upper = input.toUpperCase()
  const match = upper.match(/\b([A-Z]{2,}\d+[A-Z0-9]*-\d+[A-Z0-9]*)\b/)
  return match?.[1] ?? null
}

function getLaptopFamilyKey(candidate: Candidate): string | null {
  for (const stockRow of candidate.warehouseStock) {
    if (stockRow.warehouseId !== 'acer_store') continue
    const fromSourceName = extractLaptopModelKey(stockRow.sourceName)
    if (fromSourceName) return fromSourceName
    const fromSourceUrl = extractLaptopModelKey(stockRow.sourceUrl)
    if (fromSourceUrl) return fromSourceUrl
  }
  return extractLaptopModelKey(candidate.title)
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) return false
  }
  return true
}

function estimateEnglishScore(candidate: Candidate): number {
  const sample = `${candidate.title} ${candidate.description ?? ''}`.toLowerCase()
  let score = 0
  if (/[^\x00-\x7F]/.test(sample)) score -= 1
  if (sample.includes(' laptop') || sample.includes(' notebook') || sample.includes(' gaming')) score += 2
  for (const marker of ['kannettava', 'ordinateur', 'portatil', 'portatile', 'ultra ohut', 'ohut', 'spel', 'baerbar', 'sottile', 'fino']) {
    if (sample.includes(marker)) score -= 3
  }
  return score
}

function chooseAnchor(candidates: Candidate[]): Candidate {
  return [...candidates].sort((a, b) => {
    const scoreDiff = estimateEnglishScore(b) - estimateEnglishScore(a)
    if (scoreDiff !== 0) return scoreDiff
    const groupDiff = Number(!!b.variantGroupId) - Number(!!a.variantGroupId)
    if (groupDiff !== 0) return groupDiff
    const descriptionDiff = Number(!!b.description?.trim()) - Number(!!a.description?.trim())
    if (descriptionDiff !== 0) return descriptionDiff
    const titleDiff = normalizeWhitespace(a.title).length - normalizeWhitespace(b.title).length
    if (titleDiff !== 0) return titleDiff
    return a.id.localeCompare(b.id)
  })[0]
}

function looksLikeLaptop(title: string): boolean {
  const lower = title.toLowerCase()
  if (!lower.includes('acer') && !lower.includes('predator') && !lower.includes('nitro') && !lower.includes('swift') && !lower.includes('aspire') && !lower.includes('travelmate') && !lower.includes('chromebook')) {
    return false
  }
  return !EXCLUDE_TITLE_WORDS.some((word) => lower.includes(word))
}

async function fetchAllProducts(): Promise<ProductSummary[]> {
  const perPage = 1000
  const page = 1
  return apiGet<ProductSummary[]>(`/api/products?page=${page}&perPage=${perPage}`)
}

async function fetchDetail(sku: string): Promise<ProductDetail> {
  return apiGet<ProductDetail>(`/api/products/${encodeURIComponent(sku)}`)
}

async function main() {
  if (!ACCESS_TOKEN || !CF_ACCESS_CLIENT_ID || !CF_ACCESS_CLIENT_SECRET) {
    throw new Error('Missing AGENT_BEARER_TOKEN or CF Access headers in environment')
  }

  const catalog = await fetchAllProducts()
  const acerSummaries = catalog.filter((row) => row.supplier?.id === 'acer' || row.supplier?.name?.toUpperCase() === 'ACER')
  const likelyLaptopSkus = acerSummaries
    .filter((row) => looksLikeLaptop(row.title))
    .map((row) => row.id)

  console.log(`acer_products=${acerSummaries.length}`)
  console.log(`likely_laptops=${likelyLaptopSkus.length}`)

  const details: Candidate[] = []
  const misses: Array<{ sku: string; reason: string }> = []

  for (const sku of likelyLaptopSkus) {
    const detail = await fetchDetail(sku)
    const slugs = new Set(detail.collections.map((c) => (c.slug ?? '').trim()).filter(Boolean))
    const currentCollection = getVariantCollection(slugs)
    if (!currentCollection) {
      misses.push({ sku, reason: 'not_variant_capable' })
      continue
    }

    const attrs = detail.metafields.filter((m) => m.namespace === 'attributes').map((m) => ({ key: m.key, value: m.value }))
    const candidate: Candidate = {
      id: detail.id,
      title: detail.title,
      description: detail.description,
      variantGroupId: detail.variantGroupId,
      categories: detail.collections.map((c) => ({ slug: c.slug, categoryId: c.id })),
      metafields: attrs,
      warehouseStock: [{
        warehouseId: 'acer_store',
        sourceUrl: detail.acerStoreSourceUrl,
        sourceName: detail.acerStoreSourceName,
      }],
    }

    const attrMap = toAttrMap(candidate.metafields)
    const currentKeyboardLayout = attrMap.get('keyboard_layout') ?? null
    const currentColor = attrMap.get('color') ?? null
    const hasKeyboardLayout = !!currentKeyboardLayout
    const hasColor = !!currentColor
    if (currentCollection === 'laptops' && !hasKeyboardLayout && !hasColor) {
      misses.push({ sku, reason: 'missing_variant_axes' })
      continue
    }
    if (currentCollection === 'input-devices' && !hasKeyboardLayout) {
      misses.push({ sku, reason: 'missing_keyboard_layout' })
      continue
    }
    if (comparableAttrs(attrMap, currentCollection).size === 0) {
      misses.push({ sku, reason: 'missing_comparable_attributes' })
      continue
    }

    details.push(candidate)
  }

  const groups = new Map<string, Candidate[]>()
  for (const candidate of details) {
    const attrMap = toAttrMap(candidate.metafields)
    const collection = getVariantCollection(new Set(candidate.categories.map((c) => c.slug ?? '').filter(Boolean)))
    if (!collection) continue
    const familyKey = collection === 'laptops' ? getLaptopFamilyKey(candidate) : candidate.title
    if (!familyKey) {
      misses.push({ sku: candidate.id, reason: 'missing_family_key' })
      continue
    }
    const key = [
      collection,
      familyKey,
      JSON.stringify([...comparableAttrs(attrMap, collection)].sort(([a], [b]) => a.localeCompare(b))),
    ].join('|')
    const bucket = groups.get(key) ?? []
    bucket.push(candidate)
    groups.set(key, bucket)
  }

  const linkedGroups: Array<{ groupId: string; anchor: string; members: string[] }> = []
  const untouched: Array<{ sku: string; reason: string }> = [...misses]

  for (const [key, group] of groups.entries()) {
    if (group.length < 2) {
      untouched.push({ sku: group[0].id, reason: 'no_matching_family' })
      continue
    }

    const collection = key.startsWith('laptops|') ? 'laptops' : 'input-devices'
    const anchor = chooseAnchor(group)
    const groupId = anchor.variantGroupId ?? randomUUID()
    const anchorCategoryIds = anchor.categories.map((row) => row.categoryId)
    const normalizedTitle = normalizeFamilyTitle(anchor.title, collection)
    const familyDescription = anchor.description?.trim() ? anchor.description : null

    for (const member of group) {
      await apiPatch(`/api/products/${encodeURIComponent(member.id)}`, {
        fields: {
          title: normalizedTitle,
          description: familyDescription,
          categoryIds: anchorCategoryIds,
        },
        variantGroupId: groupId,
        triggeredBy: 'agent',
      })
    }

    linkedGroups.push({ groupId, anchor: anchor.id, members: group.map((member) => member.id) })
  }

  console.log(JSON.stringify({
    acerProducts: acerSummaries.length,
    likelyLaptopSkus: likelyLaptopSkus.length,
    linkedGroups,
    untouched: untouched.slice(0, 200),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
