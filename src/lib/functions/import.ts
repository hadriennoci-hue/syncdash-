import { db } from '@/lib/db/client'
import {
  products, productVariants, productImages, productPrices,
  productMetafields, platformMappings, categories, productCategories,
} from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { Platform, TriggeredBy } from '@/types/platform'

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: string[]
}

const WIZHARD_COLLECTION_PLATFORM: Platform = 'shopify_komputerzz'
const KEYBOARD_LAYOUT_SLUGS = new Set([
  'fra-azerty',
  'ger-qwertz',
  'ita-qwerty',
  'spa-qwerty',
  'swe-qwerty',
  'swiss-qwertz',
  'uk-qwerty',
  'us-qwerty',
])

function normalizeCollectionSlug(slug: string | null, name: string): string {
  const base = (slug ?? name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function toPlainTextLines(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(stripped)
  return decoded
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export async function importFromPlatform(
  platform: Platform,
  _mode: 'full' | 'new_changed' = 'new_changed',
  triggeredBy: TriggeredBy = 'human'
): Promise<ImportResult> {
  const connector = await createConnector(platform)
  const rawProducts = await connector.importProducts()

  // Products imported from TikTok (Ireland warehouse) are always ACER products.
  const isAcerPlatform = platform === 'shopify_tiktok'
  const isMaster       = platform === 'shopify_komputerzz'
  const now            = new Date().toISOString()

  // Resolve which SKUs already exist in one query instead of N findFirst calls
  const skus = rawProducts.map((r) => r.sku)
  const existingRows = skus.length > 0
    ? await db.select({ id: products.id }).from(products).where(inArray(products.id, skus))
    : []
  const existingSkus = new Set(existingRows.map((r) => r.id))

  const collectionPlatforms: Platform[] = isAcerPlatform
    ? [platform, WIZHARD_COLLECTION_PLATFORM]
    : [platform]
  const existingCategoryRows = await db.select({
    id: categories.id,
    platform: categories.platform,
    slug: categories.slug,
    name: categories.name,
  }).from(categories).where(inArray(categories.platform, collectionPlatforms))
  const collectionIdByPlatformSlug = new Map<string, string>()
  const categoryIdsByPlatform = new Map<string, Set<string>>()
  for (const row of existingCategoryRows) {
    const normSlug = normalizeCollectionSlug(row.slug ?? null, row.name)
    if (!normSlug) continue
    const key = `${row.platform}:${normSlug}`
    if (!collectionIdByPlatformSlug.has(key)) collectionIdByPlatformSlug.set(key, row.id)
    const set = categoryIdsByPlatform.get(row.platform) ?? new Set<string>()
    set.add(row.id)
    categoryIdsByPlatform.set(row.platform, set)
  }

  let imported = 0
  let updated  = 0
  const errors: string[] = []

  for (const raw of rawProducts) {
    try {
      const description = (isAcerPlatform && raw.description)
        ? toPlainTextLines(raw.description)
        : raw.description

      // Upsert product
      await db.insert(products).values({
        id:          raw.sku,
        title:       raw.title,
        description,
        status:      raw.status,
        taxCode:     raw.taxCode,
        weight:      raw.weight,
        weightUnit:  raw.weightUnit,
        vendor:      raw.vendor,
        productType: raw.productType,
        updatedAt:   now,
        ...(isAcerPlatform ? { supplierId: 'acer' } : {}),
      }).onConflictDoUpdate({
        target: products.id,
        set: {
          title:       raw.title,
          description,
          status:      raw.status,
          vendor:      raw.vendor,
          productType: raw.productType,
          updatedAt:   now,
          ...(isAcerPlatform ? { supplierId: 'acer' } : {}),
        },
      })

      // Variants — delete then batch insert
      await db.delete(productVariants).where(eq(productVariants.productId, raw.sku))
      if (raw.variants.length > 0) {
        await db.insert(productVariants).values(
          raw.variants.map((v, i) => ({
            id:             generateId(),
            productId:      raw.sku,
            title:          v.title,
            sku:            v.sku,
            price:          v.price,
            compareAtPrice: v.compareAtPrice,
            stock:          v.stock,
            available:      v.stock > 0 ? 1 : 0,
            position:       v.position ?? i,
            optionName1:    v.optionName1,
            option1:        v.option1,
            optionName2:    v.optionName2,
            option2:        v.option2,
            optionName3:    v.optionName3,
            option3:        v.option3,
            weight:         v.weight,
          }))
        )
      }

      // Images — master platform only; delete then batch insert
      if (isMaster) {
        await db.delete(productImages).where(eq(productImages.productId, raw.sku))
        if (raw.images.length > 0) {
          await db.insert(productImages).values(
            raw.images.map((img) => ({
              id:        generateId(),
              productId: raw.sku,
              url:       img.url,
              position:  img.position,
              alt:       img.alt,
              width:     img.width,
              height:    img.height,
            }))
          )
        }
      }

      // Prices
      await db.insert(productPrices).values({
        productId: raw.sku,
        platform,
        price:     raw.prices.price,
        compareAt: raw.prices.compareAt,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [productPrices.productId, productPrices.platform],
        set: { price: raw.prices.price, compareAt: raw.prices.compareAt, updatedAt: now },
      })

      // Metafields — master platform only; batch upsert
      if (isMaster && raw.metafields.length > 0) {
        for (const mf of raw.metafields) {
          await db.insert(productMetafields).values({
            id:        generateId(),
            productId: raw.sku,
            namespace: mf.namespace,
            key:       mf.key,
            value:     mf.value,
            type:      mf.type,
          }).onConflictDoUpdate({
            target: productMetafields.id,
            set: { value: mf.value },
          })
        }
      }

      // Collections / categories — batch upsert categories, then batch insert joins
      if (raw.collections.length > 0) {
        const normalizedCollections = raw.collections
          .map((col) => ({
            name: col.name.trim(),
            slug: normalizeCollectionSlug(col.slug ?? null, col.name),
            platformId: col.platformId,
          }))
          .filter((col) => col.name.length > 0 && col.slug.length > 0)
          .filter((col) => !(isAcerPlatform && KEYBOARD_LAYOUT_SLUGS.has(col.slug)))
        const seenSlugs = new Set<string>()
        const dedupedCollections = normalizedCollections.filter((col) => {
          if (seenSlugs.has(col.slug)) return false
          seenSlugs.add(col.slug)
          return true
        })

        const removableIds = new Set<string>([
          ...(categoryIdsByPlatform.get(platform)?.values() ?? []),
          ...(isAcerPlatform ? (categoryIdsByPlatform.get(WIZHARD_COLLECTION_PLATFORM)?.values() ?? []) : []),
        ])
        if (removableIds.size > 0) {
          await db.delete(productCategories).where(and(
            eq(productCategories.productId, raw.sku),
            inArray(productCategories.categoryId, Array.from(removableIds.values()))
          ))
        }

        const categoryIdsToLink = new Set<string>()
        for (const col of dedupedCollections) {
          const sourceKey = `${platform}:${col.slug}`
          let sourceCategoryId = collectionIdByPlatformSlug.get(sourceKey) ?? null
          if (!sourceCategoryId) {
            sourceCategoryId = `${platform}_${col.platformId}`
            await db.insert(categories).values({
              id: sourceCategoryId,
              platform,
              name: col.name,
              slug: col.slug,
              collectionType: 'product',
            }).onConflictDoUpdate({
              target: categories.id,
              set: { name: col.name, slug: col.slug },
            })
            collectionIdByPlatformSlug.set(sourceKey, sourceCategoryId)
            const sourceSet = categoryIdsByPlatform.get(platform) ?? new Set<string>()
            sourceSet.add(sourceCategoryId)
            categoryIdsByPlatform.set(platform, sourceSet)
          }
          categoryIdsToLink.add(sourceCategoryId)

          if (isAcerPlatform) {
            const wizhardKey = `${WIZHARD_COLLECTION_PLATFORM}:${col.slug}`
            let wizhardCategoryId = collectionIdByPlatformSlug.get(wizhardKey) ?? null
            if (!wizhardCategoryId) {
              wizhardCategoryId = `wizhard_${col.slug}`
              await db.insert(categories).values({
                id: wizhardCategoryId,
                platform: WIZHARD_COLLECTION_PLATFORM,
                name: col.name,
                slug: col.slug,
                collectionType: 'product',
              }).onConflictDoUpdate({
                target: categories.id,
                set: { name: col.name, slug: col.slug },
              })
              collectionIdByPlatformSlug.set(wizhardKey, wizhardCategoryId)
              const wizhardSet = categoryIdsByPlatform.get(WIZHARD_COLLECTION_PLATFORM) ?? new Set<string>()
              wizhardSet.add(wizhardCategoryId)
              categoryIdsByPlatform.set(WIZHARD_COLLECTION_PLATFORM, wizhardSet)
            }
            categoryIdsToLink.add(wizhardCategoryId)
          }
        }

        await db.insert(productCategories)
          .values(Array.from(categoryIdsToLink.values()).map((categoryId) => ({
            productId: raw.sku,
            categoryId,
          })))
          .onConflictDoNothing()
      }

      // Platform mapping
      await db.insert(platformMappings).values({
        productId:  raw.sku,
        platform,
        platformId: raw.platformId,
        recordType: raw.variants.length > 1 ? 'variant' : 'product',
        syncStatus: 'synced',
        lastSynced: now,
      }).onConflictDoUpdate({
        target: [platformMappings.productId, platformMappings.platform],
        set: { platformId: raw.platformId, syncStatus: 'synced', lastSynced: now },
      })

      existingSkus.has(raw.sku) ? updated++ : imported++
    } catch (err) {
      errors.push(`${raw.sku}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  await logOperation({
    action:      'import',
    platform,
    status:      errors.length === 0 ? 'success' : 'error',
    message:     `imported=${imported} updated=${updated} errors=${errors.length}`,
    triggeredBy,
  })

  return { imported, updated, skipped: 0, errors }
}
