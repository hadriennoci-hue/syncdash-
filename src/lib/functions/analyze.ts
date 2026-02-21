import { db } from '@/lib/db/client'
import { products, productImages, productPrices, platformMappings, productCategories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { InconsistencyReport, InconsistencyType } from '@/types/analysis'
import type { Platform } from '@/types/platform'
import { PLATFORMS } from '@/types/platform'

export async function analyzeInconsistencies(sku?: string): Promise<InconsistencyReport[]> {
  const reports: InconsistencyReport[] = []

  const allProducts = sku
    ? await db.query.products.findMany({ where: eq(products.id, sku) })
    : await db.query.products.findMany()

  for (const product of allProducts) {
    const [mappings, images, prices, cats] = await Promise.all([
      db.query.platformMappings.findMany({ where: eq(platformMappings.productId, product.id) }),
      db.query.productImages.findMany({ where: eq(productImages.productId, product.id) }),
      db.query.productPrices.findMany({ where: eq(productPrices.productId, product.id) }),
      db.query.productCategories.findMany({ where: eq(productCategories.productId, product.id) }),
    ])

    const mappingMap = Object.fromEntries(mappings.map((m) => [m.platform, m])) as
      Record<Platform, typeof mappings[0] | undefined>

    // 1. Missing on platform
    const missingOn: Platform[] = PLATFORMS.filter((p) => !mappingMap[p])
    if (missingOn.length > 0) {
      reports.push({
        sku: product.id,
        title: product.title,
        type: 'missing_on_platform',
        platforms: missingOn,
        details: `Product absent from: ${missingOn.join(', ')}`,
        suggestedFix: `Create product on ${missingOn.join(', ')}`,
      })
    }

    // 2. Missing images
    if (images.length === 0) {
      const presentOn = PLATFORMS.filter((p) => mappingMap[p])
      if (presentOn.length > 0) {
        reports.push({
          sku: product.id,
          title: product.title,
          type: 'missing_images',
          platforms: presentOn,
          details: 'No images in master catalogue',
          suggestedFix: 'Import images from Komputerzz',
        })
      }
    } else if (images.length < 5) {
      const presentOn = PLATFORMS.filter((p) => mappingMap[p])
      reports.push({
        sku: product.id,
        title: product.title,
        type: 'missing_images',
        platforms: presentOn,
        details: `Only ${images.length}/5 images in master catalogue`,
        suggestedFix: 'Add more images to reach 5',
      })
    }

    // 3. Missing categories
    if (cats.length === 0) {
      reports.push({
        sku: product.id,
        title: product.title,
        type: 'missing_categories',
        platforms: PLATFORMS.filter((p) => mappingMap[p]),
        details: 'No categories assigned',
        suggestedFix: 'Assign at least one product category',
      })
    }

    // 4. Missing description
    if (!product.description || product.description.trim() === '') {
      reports.push({
        sku: product.id,
        title: product.title,
        type: 'different_description',
        platforms: PLATFORMS,
        details: 'No description in master catalogue',
        suggestedFix: 'Add a description',
      })
    }

    // 5. Price differences (compare prices across platforms)
    const priceMap = Object.fromEntries(prices.map((p) => [p.platform, p.price])) as
      Record<Platform, number | null>
    const priceValues = PLATFORMS.map((p) => priceMap[p]).filter((v) => v !== null && v !== undefined)
    if (priceValues.length > 1) {
      const uniquePrices = new Set(priceValues)
      if (uniquePrices.size > 1) {
        reports.push({
          sku: product.id,
          title: product.title,
          type: 'different_price',
          platforms: PLATFORMS.filter((p) => priceMap[p] !== null),
          details: PLATFORMS
            .filter((p) => priceMap[p] !== null)
            .map((p) => `${p}: ${priceMap[p]}€`)
            .join(' / '),
        })
      }
    }
  }

  return reports
}
