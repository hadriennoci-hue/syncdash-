import { db } from '@/lib/db/client'
import {
  products, productVariants, productImages, productPrices,
  productMetafields, platformMappings, categories, productCategories,
} from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { Platform, TriggeredBy } from '@/types/platform'
import type { RawProduct } from '@/lib/connectors/types'

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: string[]
}

export async function importFromPlatform(
  platform: Platform,
  triggeredBy: TriggeredBy = 'human'
): Promise<ImportResult> {
  const connector = getConnector(platform)
  const rawProducts = await connector.importProducts()

  let imported = 0
  let updated = 0
  const errors: string[] = []

  for (const raw of rawProducts) {
    try {
      const existed = await db.query.products.findFirst({
        where: eq(products.id, raw.sku),
      })

      // Upsert product
      await db.insert(products).values({
        id:          raw.sku,
        title:       raw.title,
        description: raw.description,
        status:      raw.status,
        taxCode:     raw.taxCode,
        weight:      raw.weight,
        weightUnit:  raw.weightUnit,
        vendor:      raw.vendor,
        productType: raw.productType,
        updatedAt:   new Date().toISOString(),
      }).onConflictDoUpdate({
        target: products.id,
        set: {
          title:       raw.title,
          description: raw.description,
          status:      raw.status,
          vendor:      raw.vendor,
          productType: raw.productType,
          updatedAt:   new Date().toISOString(),
        },
      })

      // Variants — delete and re-insert
      await db.delete(productVariants).where(eq(productVariants.productId, raw.sku))
      for (const [i, v] of raw.variants.entries()) {
        await db.insert(productVariants).values({
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
        })
      }

      // Images — only overwrite if this is the master platform (shopify_komputerzz)
      if (platform === 'shopify_komputerzz') {
        await db.delete(productImages).where(eq(productImages.productId, raw.sku))
        for (const img of raw.images) {
          await db.insert(productImages).values({
            id:        generateId(),
            productId: raw.sku,
            url:       img.url,
            position:  img.position,
            alt:       img.alt,
            width:     img.width,
            height:    img.height,
          })
        }
      }

      // Prices
      await db.insert(productPrices).values({
        productId: raw.sku,
        platform,
        price:     raw.prices.price,
        compareAt: raw.prices.compareAt,
      }).onConflictDoUpdate({
        target: [productPrices.productId, productPrices.platform],
        set: { price: raw.prices.price, compareAt: raw.prices.compareAt },
      })

      // Metafields (Komputerzz only)
      if (platform === 'shopify_komputerzz' && raw.metafields.length > 0) {
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

      // Collections / categories
      for (const col of raw.collections) {
        await db.insert(categories).values({
          id:       `${platform}_${col.platformId}`,
          platform,
          name:     col.name,
          slug:     col.slug,
          collectionType: 'product', // default; refine based on slug patterns
        }).onConflictDoUpdate({
          target: categories.id,
          set: { name: col.name },
        })

        await db.insert(productCategories).values({
          productId:  raw.sku,
          categoryId: `${platform}_${col.platformId}`,
        }).onConflictDoNothing()
      }

      // Platform mapping
      await db.insert(platformMappings).values({
        productId:  raw.sku,
        platform,
        platformId: raw.platformId,
        recordType: raw.variants.length > 1 ? 'variant' : 'product',
        syncStatus: 'synced',
        lastSynced: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [platformMappings.productId, platformMappings.platform],
        set: {
          platformId: raw.platformId,
          syncStatus: 'synced',
          lastSynced: new Date().toISOString(),
        },
      })

      existed ? updated++ : imported++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${raw.sku}: ${message}`)
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
