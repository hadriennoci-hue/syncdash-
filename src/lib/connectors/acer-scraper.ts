import FirecrawlApp from '@mendable/firecrawl-js'
import { z } from 'zod'
import type { WarehouseConnector, WarehouseStockSnapshot, HealthCheckResult } from './types'

const EXTRACT_PROMPT =
  'Extract product information across all paginated results. ' +
  'For each product, capture: name, SKU reference from the SKU-wrapper element, ' +
  'price, product URL, and the promo price from the b2c-2025-promo-text-block1 element. ' +
  'If a product appears out of stock (greyed out, unavailable badge, disabled add-to-cart), ' +
  'set inStock to false. Output a flat list of all products found.'

const AcerProductSchema = z.object({
  products: z.array(
    z.object({
      name: z.string(),
      sku: z.string(),
      price: z.number().nullable(),
      promoPrice: z.number().nullable(),
      url: z.string(),
      inStock: z.boolean().default(true),
    })
  ),
})

const HealthSchema = z.object({
  products: z.array(z.object({ name: z.string(), sku: z.string() })).max(1),
})

export const ProductDetailSchema = z.object({
  description: z.string(),   // translated to English by Firecrawl
  category: z.string(),
  imageUrls: z.array(z.string().url()).max(5),
  price: z.number().nullable(),
  promoPrice: z.number().nullable(),
})

export type ProductDetail = z.infer<typeof ProductDetailSchema>

const DETAIL_PROMPT =
  'Extract from this product page: ' +
  '1) the full product description translated to English, ' +
  '2) the main product category (e.g. "Monitor", "Keyboard", "Headset"), ' +
  '3) up to 5 product image URLs (main product photos only, not UI icons or thumbnails), ' +
  '4) the regular price as a number, ' +
  '5) the promotional/discounted price as a number if shown, otherwise null.'

export async function scrapeProductDetail(
  firecrawl: FirecrawlApp,
  url: string
): Promise<ProductDetail> {
  const result = await firecrawl.extract([url], {
    prompt: DETAIL_PROMPT,
    schema: ProductDetailSchema,
  })

  if (!result.success) {
    const msg = 'error' in result ? String(result.error) : 'Firecrawl error'
    throw new Error(`Failed to scrape product detail for ${url}: ${msg}`)
  }

  const parsed = ProductDetailSchema.safeParse(result.data)
  if (!parsed.success) {
    throw new Error(`Unexpected scrape response for ${url}: ${parsed.error.message}`)
  }
  return parsed.data
}

export class AcerScraperConnector implements WarehouseConnector {
  private readonly firecrawl: FirecrawlApp
  private readonly urls: string[]

  constructor(apiKey: string, urls: string[]) {
    this.firecrawl = new FirecrawlApp({ apiKey })
    this.urls = urls
  }

  async getStock(): Promise<WarehouseStockSnapshot[]> {
    const seen = new Set<string>()
    const snapshots: WarehouseStockSnapshot[] = []

    for (const baseUrl of this.urls) {
      // Crawl the category including all paginated pages.
      // includePaths constrains crawling to the same category path so we
      // don't follow individual product detail pages or unrelated sections.
      const categoryPath = new URL(baseUrl).pathname
      const crawlResult = await this.firecrawl.crawlUrl(baseUrl, {
        limit: 20,
        includePaths: [`${categoryPath}*`],
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }, true)

      if (!crawlResult.success || !('data' in crawlResult) || !crawlResult.data?.length) continue

      const pageUrls = (crawlResult.data as Array<{ metadata?: { sourceURL?: string } }>)
        .map((d) => d.metadata?.sourceURL)
        .filter((u): u is string => Boolean(u))

      if (pageUrls.length === 0) continue

      // Extract structured product data from all discovered pages at once
      const result = await this.firecrawl.extract(pageUrls, {
        prompt: EXTRACT_PROMPT,
        schema: AcerProductSchema,
      })

      if (!result.success) {
        const msg = 'error' in result ? String(result.error) : 'Unknown Firecrawl error'
        throw new Error(`Firecrawl extraction failed for ${baseUrl}: ${msg}`)
      }

      const parsed = AcerProductSchema.safeParse(result.data)
      if (!parsed.success) {
        throw new Error(`Unexpected Firecrawl response shape for ${baseUrl}: ${parsed.error.message}`)
      }

      for (const product of parsed.data.products) {
        const sku = product.sku.trim()
        if (!sku || seen.has(sku)) continue
        seen.add(sku)
        snapshots.push({
          sku,
          quantity:         product.inStock ? 1 : 0,
          sourceUrl:        product.url,
          sourceName:       product.name,
          importPrice:      product.price ?? null,
          importPromoPrice: product.promoPrice ?? null,
        })
      }
    }

    return snapshots
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const result = await this.firecrawl.extract([this.urls[0]], {
        prompt: 'Return the name and SKU of the first product visible on the page.',
        schema: HealthSchema,
      })
      return {
        ok: result.success,
        latencyMs: Date.now() - start,
        error: result.success
          ? null
          : 'error' in result ? String(result.error) : 'Unknown error',
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
