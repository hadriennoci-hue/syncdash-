/**
 * TikTok readiness gate (docs/tiktok-readiness-spec.md §5).
 *
 * Given a product's readiness-relevant data and the set of fields a channel *requires*
 * (channel_field_rules.required=1), report whether the product is ready to list and, if not,
 * exactly which required fields are missing. `computeReadiness` is pure/testable;
 * `checkProductReadiness` wires it to the DB (product + supplier GPSR + image rating + config).
 */
import { db } from '@/lib/db/client'
import { products, suppliers, channelFieldRules, channelCategoryMap } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { TIKTOK_IMAGE_POLICY } from '@/lib/constants/tiktok-image-policy'
import { rateProductImages } from './tiktok-image-rating'

const ROOT_CATEGORY_GID = 'gid://shopify/TaxonomyCategory/el'
const GTIN_RE = /^\d{8,14}$/

export interface ReadinessInput {
  title?: string | null
  description?: string | null
  ean?: string | null
  price?: number | null
  categoryGid?: string | null   // resolved Shopify category (root 'el' does not count)
  hasAttributes?: boolean
  packageLengthMm?: number | null
  packageWidthMm?: number | null
  packageHeightMm?: number | null
  packageWeightG?: number | null
  gpsrComplete?: boolean         // supplier manufacturer + EU responsible person present
  imagePassCount?: number
  imageMainOk?: boolean
}

/** One checker per field_key. A required key with no checker is treated as satisfied. */
export const READINESS_CHECKERS: Record<string, (i: ReadinessInput) => boolean> = {
  title:          (i) => !!i.title && i.title.trim().length >= 25,       // TikTok min 25 chars
  description:    (i) => !!i.description && i.description.trim().length >= 80,
  price:          (i) => i.price != null && i.price > 0,
  ean:            (i) => !!i.ean && GTIN_RE.test(i.ean.trim()),          // real GTIN, not a part number
  images:         (i) => (i.imagePassCount ?? 0) >= TIKTOK_IMAGE_POLICY.minCountGood && !!i.imageMainOk,
  category:       (i) => !!i.categoryGid && i.categoryGid !== ROOT_CATEGORY_GID,
  attributes:     (i) => !!i.hasAttributes,
  package_dims:   (i) => !!i.packageLengthMm && !!i.packageWidthMm && !!i.packageHeightMm,
  package_weight: (i) => (i.packageWeightG ?? 0) > 0,
  gpsr:           (i) => !!i.gpsrComplete,
}

export interface ReadinessResult {
  ready: boolean
  missing: string[]
}

/** Pure: which required fields fail their checker. */
export function computeReadiness(input: ReadinessInput, required: string[]): ReadinessResult {
  const missing = required.filter((key) => {
    const check = READINESS_CHECKERS[key]
    return check ? !check(input) : false
  })
  return { ready: missing.length === 0, missing }
}

/** DB wrapper: assemble a product's readiness input for a channel and evaluate it. */
export async function checkProductReadiness(
  sku: string,
  platform: string,
): Promise<ReadinessResult & { sku: string }> {
  const product = await db.query.products.findFirst({
    where: eq(products.id, sku),
    with: { metafields: true, prices: true },
  })
  if (!product) return { sku, ready: false, missing: ['product_not_found'] }

  const supplier = product.supplierId
    ? await db.query.suppliers.findFirst({ where: eq(suppliers.id, product.supplierId) })
    : null

  const requiredRows = await db.query.channelFieldRules.findMany({
    where: and(eq(channelFieldRules.platform, platform), eq(channelFieldRules.required, 1)),
  })
  const required = requiredRows.map((r) => r.fieldKey)

  const catRow = product.taxonomyKey
    ? await db.query.channelCategoryMap.findFirst({
        where: and(
          eq(channelCategoryMap.platform, platform),
          eq(channelCategoryMap.taxonomyKey, product.taxonomyKey),
        ),
      })
    : null

  const rollup = await rateProductImages(sku)
  const priceRow = product.prices.find((p) => p.platform === platform)

  const input: ReadinessInput = {
    title: product.title,
    description: product.description,
    ean: product.ean,
    price: priceRow?.price ?? null,
    categoryGid: catRow?.shopifyCategoryGid ?? null,
    hasAttributes: product.metafields.some(
      (m) => m.namespace === 'attributes' && (m.value ?? '').trim().length > 0,
    ),
    packageLengthMm: product.packageLengthMm,
    packageWidthMm: product.packageWidthMm,
    packageHeightMm: product.packageHeightMm,
    packageWeightG: product.packageWeightG,
    gpsrComplete: !!(supplier?.manufacturerName && supplier?.euRpName),
    imagePassCount: rollup.passCount,
    imageMainOk: rollup.mainOk,
  }

  return { sku, ...computeReadiness(input, required) }
}
