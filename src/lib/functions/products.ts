import { db } from '@/lib/db/client'
import {
  products, productVariants, productImages, productPrices,
  productMetafields, platformMappings, productCategories,
} from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createConnector } from '@/lib/connectors/registry'
import { logOperation } from './log'
import { generateId } from '@/lib/utils/id'
import type { Platform, SyncResult, TriggeredBy, ImageInput } from '@/types/platform'

function cleanDescription(desc?: string | null): string | null {
  if (!desc) return desc ?? null
  return desc
    .replace(/\u2122/g, '')  // ™
    .replace(/\u00ae/g, '')  // ®
    .replace(/\u00a9/g, '')  // ©
    .replace(/ {2,}/g, ' ')
    .replace(/ +$/gm, '')
    .replace(/^ +/gm, '')
    || null
}

function normalizeTags(tags?: string[]): string[] | undefined {
  if (!tags) return undefined
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (!tag) continue
    if (/\s/.test(tag)) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(tag)
    if (normalized.length >= 10) break
  }

  return normalized
}

// ---------------------------------------------------------------------------
// createProduct
// ---------------------------------------------------------------------------

interface CreateProductInput {
  sku: string
  title: string
  ean?: string
  description?: string
  tags?: string[]
  vendor?: string
  productType?: string
  taxCode?: string
  isFeatured?: boolean
  supplierId?: string
  variants?: Array<{
    title?: string
    sku?: string
    price?: number
    compareAt?: number
    stock?: number
    optionName1?: string
    option1?: string
    optionName2?: string
    option2?: string
    optionName3?: string
    option3?: string
    weight?: number
  }>
  images?: ImageInput[]
  prices?: Partial<Record<Platform, number>>
  compareAtPrices?: Partial<Record<Platform, number>>
  categoryIds?: string[]
  platforms: Platform[]
  triggeredBy?: TriggeredBy
}

export async function createProduct(
  input: CreateProductInput
): Promise<SyncResult[]> {
  const triggeredBy = input.triggeredBy ?? 'human'

  // 1. Upsert into D1
  await db.insert(products).values({
    id:          input.sku,
    title:       input.title,
    ean:         input.ean ?? null,
    description: cleanDescription(input.description),
    tags:        JSON.stringify(normalizeTags(input.tags) ?? []),
    status:      'active',
    taxCode:     input.taxCode ?? null,
    vendor:      input.vendor ?? null,
    productType: input.productType ?? null,
    isFeatured:  input.isFeatured ? 1 : 0,
    supplierId:  input.supplierId ?? null,
    updatedAt:   new Date().toISOString(),
  }).onConflictDoUpdate({
    target: products.id,
    set: {
      title:       input.title,
      ean:         input.ean ?? null,
      description: cleanDescription(input.description),
      tags:        JSON.stringify(normalizeTags(input.tags) ?? []),
      updatedAt:   new Date().toISOString(),
    },
  })

  // 2. Variants
  if (input.variants?.length) {
    for (const v of input.variants) {
      await db.insert(productVariants).values({
        id:             generateId(),
        productId:      input.sku,
        title:          v.title ?? null,
        sku:            v.sku ?? null,
        price:          v.price ?? null,
        compareAtPrice: v.compareAt ?? null,
        stock:          v.stock ?? 0,
        optionName1:    v.optionName1 ?? null,
        option1:        v.option1 ?? null,
        optionName2:    v.optionName2 ?? null,
        option2:        v.option2 ?? null,
        optionName3:    v.optionName3 ?? null,
        option3:        v.option3 ?? null,
        weight:         v.weight ?? null,
      })
    }
  }

  // 3. Prices in D1
  if (input.prices) {
    for (const [platform, price] of Object.entries(input.prices)) {
      await db.insert(productPrices).values({
        productId: input.sku,
        platform,
        price:     price ?? null,
        compareAt: input.compareAtPrices?.[platform as Platform] ?? null,
        updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [productPrices.productId, productPrices.platform],
        set: { price: price ?? null, updatedAt: new Date().toISOString() },
      })
    }
  }

  // 4. Categories in D1
  if (input.categoryIds?.length) {
    for (const catId of input.categoryIds) {
      await db.insert(productCategories).values({
        productId:  input.sku,
        categoryId: catId,
      }).onConflictDoNothing()
    }
  }

  // 5. Push to each platform
  const results: SyncResult[] = []

  for (const platform of input.platforms) {
    try {
      const connector = await createConnector(platform)
      const platformId = await connector.createProduct({
        sku:         input.sku,
        ean:         input.ean ?? null,
        title:       input.title,
        description: cleanDescription(input.description),
        status:      'active',
        vendor:      input.vendor ?? null,
        productType: input.productType ?? null,
        taxCode:     input.taxCode ?? null,
        price:       input.prices?.[platform] ?? null,
        compareAt:   input.compareAtPrices?.[platform] ?? null,
        variants:    input.variants?.map((v) => ({
          title:     v.title ?? null,
          sku:       v.sku ?? null,
          price:     v.price ?? null,
          compareAt: v.compareAt ?? null,
          stock:     v.stock ?? 0,
          optionName1: v.optionName1 ?? null,
          option1:   v.option1 ?? null,
          optionName2: v.optionName2 ?? null,
          option2:   v.option2 ?? null,
          optionName3: v.optionName3 ?? null,
          option3:   v.option3 ?? null,
        })),
        categoryIds: input.categoryIds,
      })

      // Store platform mapping
      await db.insert(platformMappings).values({
        productId:  input.sku,
        platform,
        platformId,
        recordType: 'product',
        syncStatus: 'synced',
        lastSynced: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: [platformMappings.productId, platformMappings.platform],
        set: { platformId, syncStatus: 'synced', lastSynced: new Date().toISOString() },
      })

      await logOperation({ productId: input.sku, platform, action: 'create', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: input.sku, platform, action: 'create', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// updateProduct
// ---------------------------------------------------------------------------

interface UpdateProductInput {
  fields: {
    title?: string
    description?: string
    tags?: string[]
    status?: 'active' | 'archived'
    isFeatured?: boolean
    categoryIds?: string[]
    variantGroupId?: string | null
  }
  platforms?: Platform[]
  triggeredBy?: TriggeredBy
}

export async function updateProduct(
  sku: string,
  input: UpdateProductInput
): Promise<SyncResult[]> {
  const triggeredBy = input.triggeredBy ?? 'human'

  // Update D1
  const d1Update: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (input.fields.title !== undefined)       d1Update.title = input.fields.title
  if (input.fields.description !== undefined) d1Update.description = cleanDescription(input.fields.description)
  if (input.fields.tags !== undefined)        d1Update.tags = JSON.stringify(normalizeTags(input.fields.tags) ?? [])
  if (input.fields.status !== undefined)      d1Update.status = input.fields.status
  if (input.fields.isFeatured !== undefined)  d1Update.isFeatured = input.fields.isFeatured ? 1 : 0
  if ('variantGroupId' in input.fields)       d1Update.variantGroupId = input.fields.variantGroupId ?? null

  await db.update(products)
    .set(d1Update)
    .where(eq(products.id, sku))

  if (input.fields.categoryIds) {
    await db.delete(productCategories).where(eq(productCategories.productId, sku))
    for (const catId of input.fields.categoryIds) {
      await db.insert(productCategories).values({ productId: sku, categoryId: catId }).onConflictDoNothing()
    }
  }

  // Push to platforms
  const results: SyncResult[] = []
  const platforms = input.platforms ?? []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found — create product first' })
        continue
      }

      const connector = await createConnector(platform)
      await connector.updateProduct(mapping.platformId, {
        title:       input.fields.title,
        description: cleanDescription(input.fields.description),
        status:      input.fields.status,
        categoryIds: input.fields.categoryIds,
      })

      await db.update(platformMappings)
        .set({ syncStatus: 'synced', lastSynced: new Date().toISOString() })
        .where(and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)))

      await logOperation({ productId: sku, platform, action: 'update_fields', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'update_fields', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// updateProductLocal — update D1 only (no platform push)
// ---------------------------------------------------------------------------

interface UpdateProductLocalInput {
  fields: {
    title?: string
    description?: string
    tags?: string[]
    status?: 'active' | 'archived'
    isFeatured?: boolean
    categoryIds?: string[]
  }
  triggeredBy?: TriggeredBy
}

export async function updateProductLocal(
  sku: string,
  input: UpdateProductLocalInput
): Promise<void> {
  const triggeredBy = input.triggeredBy ?? 'human'

  const d1Update: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (input.fields.title !== undefined)       d1Update.title = input.fields.title
  if (input.fields.description !== undefined) d1Update.description = cleanDescription(input.fields.description)
  if (input.fields.tags !== undefined)        d1Update.tags = JSON.stringify(normalizeTags(input.fields.tags) ?? [])
  if (input.fields.status !== undefined)      d1Update.status = input.fields.status
  if (input.fields.isFeatured !== undefined)  d1Update.isFeatured = input.fields.isFeatured ? 1 : 0

  await db.update(products)
    .set(d1Update)
    .where(eq(products.id, sku))

  if (input.fields.categoryIds) {
    await db.delete(productCategories).where(eq(productCategories.productId, sku))
    for (const catId of input.fields.categoryIds) {
      await db.insert(productCategories).values({ productId: sku, categoryId: catId }).onConflictDoNothing()
    }
  }

  await logOperation({
    productId: sku,
    action:    'update_local',
    status:    'success',
    triggeredBy,
  })
}

// ---------------------------------------------------------------------------
// toggleProductStatus
// ---------------------------------------------------------------------------

export async function toggleProductStatus(
  sku: string,
  status: 'active' | 'archived',
  platforms: Platform[] = [],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  await db.update(products)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(products.id, sku))

  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connToggle = await createConnector(platform)
      await connToggle.toggleStatus(mapping.platformId, status)
      await logOperation({ productId: sku, platform, action: 'toggle_status', status: 'success', triggeredBy })
      results.push({ platform, success: true, platformId: mapping.platformId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'toggle_status', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// deleteProduct
// ---------------------------------------------------------------------------

export async function deleteProduct(
  sku: string,
  platforms: Platform[],
  triggeredBy: TriggeredBy = 'human'
): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  for (const platform of platforms) {
    try {
      const mapping = await db.query.platformMappings.findFirst({
        where: and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)),
      })
      if (!mapping) {
        results.push({ platform, success: false, error: 'No platform mapping found' })
        continue
      }
      const connDel = await createConnector(platform)
      await connDel.deleteProduct(mapping.platformId)
      await db.delete(platformMappings)
        .where(and(eq(platformMappings.productId, sku), eq(platformMappings.platform, platform)))
      await logOperation({ productId: sku, platform, action: 'delete', status: 'success', triggeredBy })
      results.push({ platform, success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOperation({ productId: sku, platform, action: 'delete', status: 'error', message, triggeredBy })
      results.push({ platform, success: false, error: message })
    }
  }

  return results
}
