import { randomUUID } from 'crypto'
import { eq, ne } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { productCategories, productMetafields, products } from '@/lib/db/schema'
import { logOperation } from './log'
import type { TriggeredBy } from '@/types/platform'

type AttrRow = { key: string; value: string | null }

interface ProductFamilyCandidate {
  id: string
  title: string
  description: string | null
  variantGroupId: string | null
  categories: Array<{ categoryId: string; slug: string | null }>
  metafields: AttrRow[]
  warehouseStock: Array<{ warehouseId: string; sourceUrl: string | null; sourceName: string | null }>
}

const VARIANT_CAPABLE_COLLECTIONS = new Set(['laptops', 'input-devices'])
const LAPTOP_VARIANT_KEYS = new Set(['keyboard_layout', 'color'])
const NON_ENGLISH_TITLE_MARKERS = [
  'kannettava',
  'ordinateur',
  'portatil',
  'portatile',
  'portatiles',
  'ultra ohut',
  'ohut',
  'spel',
  'baerbar',
  'bärbar',
  'sottile',
  'fino',
]
const LAPTOP_TITLE_COLOR_SUFFIXES = [
  'Black',
  'White',
  'Silver',
  'Gray',
  'Grey',
  'Blue',
  'Red',
  'Green',
  'Gold',
  'Pink',
]

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
    if (collectionSlug === 'laptops' && LAPTOP_VARIANT_KEYS.has(key)) continue
    if (collectionSlug === 'input-devices' && key === 'keyboard_layout') continue
    comparable.set(key, value)
  }
  return comparable
}

function getVariantCollection(slugs: Set<string>): 'laptops' | 'input-devices' | null {
  if (slugs.has('laptops')) return 'laptops'
  if (slugs.has('input-devices')) return 'input-devices'
  return null
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function stripTrailingLaptopColor(title: string): string {
  const normalized = normalizeWhitespace(title)
  for (const color of LAPTOP_TITLE_COLOR_SUFFIXES) {
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

function extractLaptopModelKey(input: string | null | undefined): string | null {
  if (!input) return null
  const upper = input.toUpperCase()
  const match = upper.match(/\b([A-Z]{2,}\d+[A-Z0-9]*-\d+[A-Z0-9]*)\b/)
  return match?.[1] ?? null
}

function getLaptopFamilyKey(candidate: ProductFamilyCandidate): string | null {
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

function estimateEnglishScore(candidate: ProductFamilyCandidate): number {
  const sample = `${candidate.title} ${candidate.description ?? ''}`.toLowerCase()
  let score = 0
  if (/[^\x00-\x7F]/.test(sample)) score -= 1
  if (sample.includes(' laptop') || sample.includes(' notebook') || sample.includes('gaming')) score += 2
  for (const marker of NON_ENGLISH_TITLE_MARKERS) {
    if (sample.includes(marker)) score -= 3
  }
  return score
}

function chooseAnchor(candidates: ProductFamilyCandidate[]): ProductFamilyCandidate {
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

async function replaceProductCategories(productId: string, categoryIds: string[]): Promise<void> {
  await db.delete(productCategories).where(eq(productCategories.productId, productId))
  for (const categoryId of categoryIds) {
    await db.insert(productCategories).values({ productId, categoryId }).onConflictDoNothing()
  }
}

export async function autoLinkVariantFamily(
  sku: string,
  triggeredBy: TriggeredBy = 'agent',
): Promise<{
  linked: boolean
  reason?: string
  groupId?: string
  sourceSku?: string
  siblingSkus?: string[]
}> {
  const current = await db.query.products.findFirst({
    where: eq(products.id, sku),
    columns: { id: true, title: true, description: true, variantGroupId: true },
    with: {
      categories: {
        with: { category: { columns: { slug: true } } },
      },
      warehouseStock: {
        columns: { warehouseId: true, sourceUrl: true, sourceName: true },
      },
      metafields: {
        where: eq(productMetafields.namespace, 'attributes'),
        columns: { key: true, value: true },
      },
    },
  })

  if (!current) return { linked: false, reason: 'not_found' }

  const currentSlugs = new Set(
    current.categories
      .map((row) => row.category?.slug ?? null)
      .filter((slug): slug is string => !!slug)
  )
  const currentVariantCollection = getVariantCollection(currentSlugs)
  if (!currentVariantCollection || !VARIANT_CAPABLE_COLLECTIONS.has(currentVariantCollection)) {
    return { linked: false, reason: 'not_variant_capable' }
  }

  const currentAttrMap = toAttrMap(current.metafields)
  const currentKeyboardLayout = currentAttrMap.get('keyboard_layout') ?? null
  const currentColor = currentAttrMap.get('color') ?? null
  const hasKeyboardLayout = !!currentKeyboardLayout
  const hasColor = !!currentColor
  if (currentVariantCollection === 'laptops') {
    if (!hasKeyboardLayout && !hasColor) return { linked: false, reason: 'missing_variant_axes' }
  } else if (!hasKeyboardLayout) {
    return { linked: false, reason: 'missing_keyboard_layout' }
  }

  const currentComparable = comparableAttrs(currentAttrMap, currentVariantCollection)
  if (currentComparable.size === 0) return { linked: false, reason: 'missing_comparable_attributes' }
  const currentLaptopFamilyKey = currentVariantCollection === 'laptops'
    ? getLaptopFamilyKey({
        id: current.id,
        title: current.title,
        description: current.description,
        variantGroupId: current.variantGroupId ?? null,
        categories: current.categories.map((row) => ({ categoryId: row.categoryId, slug: row.category?.slug ?? null })),
        metafields: current.metafields,
        warehouseStock: current.warehouseStock,
      })
    : null

  const candidates = await db.query.products.findMany({
    where: ne(products.id, sku),
    columns: { id: true, title: true, description: true, variantGroupId: true },
    with: {
      categories: {
        with: { category: { columns: { slug: true } } },
      },
      warehouseStock: {
        columns: { warehouseId: true, sourceUrl: true, sourceName: true },
      },
      metafields: {
        where: eq(productMetafields.namespace, 'attributes'),
        columns: { key: true, value: true },
      },
    },
  })

  const matching = candidates
    .filter((candidate) => candidate.categories.some((row) => row.category?.slug === 'laptops'))
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      variantGroupId: candidate.variantGroupId ?? null,
      categories: candidate.categories.map((row) => ({ categoryId: row.categoryId, slug: row.category?.slug ?? null })),
      metafields: candidate.metafields,
      warehouseStock: candidate.warehouseStock,
    }))
    .filter((candidate) => {
      const candidateSlugs = new Set(
        candidate.categories
          .map((row) => row.slug)
          .filter((slug): slug is string => !!slug)
      )
      const candidateCollection = getVariantCollection(candidateSlugs)
      if (!candidateCollection || candidateCollection !== currentVariantCollection) return false

      const attrMap = toAttrMap(candidate.metafields)
      if (currentVariantCollection === 'laptops') {
        const candidateLaptopFamilyKey = getLaptopFamilyKey(candidate)
        if (!currentLaptopFamilyKey || !candidateLaptopFamilyKey || candidateLaptopFamilyKey !== currentLaptopFamilyKey) {
          return false
        }
      }
      const keyboardLayout = attrMap.get('keyboard_layout') ?? null
      const color = attrMap.get('color') ?? null
      if (currentVariantCollection === 'laptops') {
        const sameKeyboardLayout = keyboardLayout === currentKeyboardLayout
        const sameColor = color === currentColor
        if (sameKeyboardLayout && sameColor) return false
      } else if (!keyboardLayout || keyboardLayout === currentKeyboardLayout) {
        return false
      }
      return mapsEqual(currentComparable, comparableAttrs(attrMap, currentVariantCollection))
    })

  if (matching.length === 0) return { linked: false, reason: 'no_matching_family' }

  const anchor = chooseAnchor(matching)
  const groupId = anchor.variantGroupId ?? randomUUID()
  const familySkuSet = new Set<string>([sku, ...matching.map((candidate) => candidate.id)])
  const normalizedTitle = normalizeFamilyTitle(anchor.title, currentVariantCollection)
  const familyDescription = anchor.description?.trim() ? anchor.description : current.description

  for (const familySku of familySkuSet) {
    await db.update(products)
      .set({
        variantGroupId: groupId,
        title: normalizedTitle,
        description: familyDescription ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, familySku))
  }

  const anchorCategoryIds = anchor.categories.map((row) => row.categoryId)
  if (anchorCategoryIds.length > 0) {
    for (const familySku of familySkuSet) {
      await replaceProductCategories(familySku, anchorCategoryIds)
    }
  }

  await logOperation({
    productId: sku,
    action: 'auto_link_variant_family',
    status: 'success',
    message: `group=${groupId} source=${anchor.id} siblings=${[...familySkuSet].join(',')}`,
    triggeredBy,
  })

  return {
    linked: true,
    groupId,
    sourceSku: anchor.id,
    siblingSkus: [...familySkuSet].filter((familySku) => familySku !== sku),
  }
}

export const autoLinkLaptopVariantFamily = autoLinkVariantFamily
