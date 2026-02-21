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

    for (const url of this.urls) {
      const result = await this.firecrawl.extract([url], {
        prompt: EXTRACT_PROMPT,
        schema: AcerProductSchema,
      })

      if (!result.success) {
        const msg = 'error' in result ? String(result.error) : 'Unknown Firecrawl error'
        throw new Error(`Firecrawl extraction failed for ${url}: ${msg}`)
      }

      const parsed = AcerProductSchema.safeParse(result.data)
      if (!parsed.success) {
        throw new Error(`Unexpected Firecrawl response shape for ${url}: ${parsed.error.message}`)
      }

      for (const product of parsed.data.products) {
        const sku = product.sku.trim()
        if (!sku || seen.has(sku)) continue
        seen.add(sku)
        snapshots.push({ sku, quantity: product.inStock ? 1 : 0 })
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
          : 'error' in result
          ? String(result.error)
          : 'Unknown error',
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
