import FirecrawlApp from '@mendable/firecrawl-js'
import { z } from 'zod'
import type { WarehouseConnector, WarehouseStockSnapshot, HealthCheckResult } from './types'

const EXTRACT_PROMPT =
  'Extract product information from this page only. ' +
  'For each product, capture: name, SKU reference from the SKU-wrapper element, ' +
  'price, product URL, and the promo price from the b2c-2025-promo-text-block1 element. ' +
  'If a product appears out of stock (greyed out, unavailable badge, disabled add-to-cart), ' +
  'set inStock to false. Output a flat list of all products found.'

const PAGINATION_PROMPT =
  'Extract all pagination page URLs for this category (including the current page). ' +
  'Return a list of absolute URLs in display order. If no pagination exists, return an empty list.'

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

const PaginationSchema = z.object({
  pageUrls: z.array(z.string().url()).default([]),
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
    const blockedNameTokens = ['trouver', 'réparation', 'mcafee']

    for (const baseUrl of this.urls) {
      // Pagination discovery is per-category and sequential to avoid Firecrawl concurrency limits.
      let pageUrls: string[] = []
      try {
        const pageResult = await this.firecrawl.extract([baseUrl], {
          prompt: PAGINATION_PROMPT,
          schema: PaginationSchema,
        })
        if (pageResult.success) {
          const parsedPages = PaginationSchema.safeParse(pageResult.data)
          if (parsedPages.success) {
            pageUrls = parsedPages.data.pageUrls
          }
        }
      } catch {
        pageUrls = []
      }

      const urlsToFetch = pageUrls.length > 0 ? pageUrls : [baseUrl]

      for (const pageUrl of urlsToFetch) {
        let result: Awaited<ReturnType<typeof this.firecrawl.extract>>
        try {
          result = await this.firecrawl.extract([pageUrl], {
            prompt: EXTRACT_PROMPT,
            schema: AcerProductSchema,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Firecrawl extract failed: ${msg}`)
        }

        if (!result.success) {
          const msg = 'error' in result ? String(result.error) : 'Unknown Firecrawl error'
          throw new Error(`Firecrawl extraction failed: ${msg}`)
        }

        const parsed = AcerProductSchema.safeParse(result.data)
        if (!parsed.success) {
          throw new Error(`Unexpected Firecrawl response shape: ${parsed.error.message}`)
        }

        for (const product of parsed.data.products) {
          const name = product.name.trim()
          const nameLower = name.toLowerCase()
          if (blockedNameTokens.some((token) => nameLower.includes(token))) continue
          const sku = product.sku.trim()
          if (!sku || seen.has(sku)) continue
          seen.add(sku)
          snapshots.push({
            sku,
            quantity:         product.inStock ? 2 : 0,
            sourceUrl:        product.url,
            sourceName:       name,
            importPrice:      product.price ?? null,
            importPromoPrice: product.promoPrice ?? null,
          })
        }
      }
    }

    return snapshots
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const firstUrl = this.urls[0]
      if (!firstUrl) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: 'No ACER_STORE_SCRAPE_URLS configured',
        }
      }
      // ACER URL is considered live by policy for health checks.
      // Verify only Firecrawl API communication with a minimal extract request.
      const result = await this.firecrawl.extract([firstUrl], {
        prompt: 'Return the name and SKU of the first product visible on the page.',
        schema: HealthSchema,
      })
      if (!result.success) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Firecrawl communication failed: ${'error' in result ? String(result.error) : 'unknown error'}`,
        }
      }

      return {
        ok: true,
        latencyMs: Date.now() - start,
        error: null,
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
