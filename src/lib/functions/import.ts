import { db } from '@/lib/db/client'
import {
  products, productVariants, productImages, productPrices,
  productMetafields, platformMappings, categories, productCategories,
} from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
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
            option1:        v.option1,
            option2:        v.option2,
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
        for (const col of raw.collections) {
          await db.insert(categories).values({
            id:             `${platform}_${col.platformId}`,
            platform,
            name:           col.name,
            slug:           col.slug,
            collectionType: 'product',
          }).onConflictDoUpdate({
            target: categories.id,
            set: { name: col.name },
          })
        }
        await db.insert(productCategories)
          .values(raw.collections.map((col) => ({
            productId:  raw.sku,
            categoryId: `${platform}_${col.platformId}`,
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
