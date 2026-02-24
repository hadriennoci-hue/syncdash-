import { woocommerceLimiter } from '@/lib/utils/rate-limiter'
import type {
  PlatformConnector, RawProduct, RawVariant, RawImage, RawCollection,
  ProductPayload, HealthCheckResult,
} from './types'
import type { ImageInput } from '@/types/platform'

export class WooCommerceConnector implements PlatformConnector {
  private readonly baseUrl: string
  private readonly auth: string

  constructor(
    private readonly siteUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string
  ) {
    this.baseUrl = `${siteUrl}/wp-json/wc/v3`
    this.auth = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  }

  // -------------------------------------------------------------------------
  // REST helper
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    await woocommerceLimiter.throttle()
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.auth,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`WooCommerce error: ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }

  // -------------------------------------------------------------------------
  // Import (paginated — max 100 per page)
  // -------------------------------------------------------------------------

  async importProducts(): Promise<RawProduct[]> {
    const products: RawProduct[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const items = await this.request<unknown[]>(
        'GET',
        `/products?per_page=100&page=${page}&status=any`
      )
      for (const item of items) {
        const product = this.normalizeProduct(item as Record<string, unknown>)
        if (product) products.push(product)
      }
      hasMore = items.length === 100
      page++
    }

    return products
  }

  private normalizeProduct(p: Record<string, unknown>): RawProduct | null {
    try {
      const variants: RawVariant[] = []

      // WooCommerce variable products have variations
      if (p.type === 'variable' && Array.isArray(p.variations) && (p.variations as unknown[]).length > 0) {
        // Variations loaded separately during full sync
        // For now create a stub
        variants.push({
          platformId:    String(p.id),
          title:         'Default',
          sku:           (p.sku as string) ?? null,
          price:         p.price ? parseFloat(p.price as string) : null,
          compareAtPrice: p.regular_price && p.sale_price
            ? parseFloat(p.regular_price as string)
            : null,
          stock:         (p.stock_quantity as number) ?? 0,
          position:      0,
          option1:       null,
          option2:       null,
          option3:       null,
          weight:        p.weight ? parseFloat(p.weight as string) : null,
        })
      } else {
        variants.push({
          platformId:    String(p.id),
          title:         null,
          sku:           (p.sku as string) ?? null,
          price:         p.price ? parseFloat(p.price as string) : null,
          compareAtPrice: p.regular_price && p.sale_price
            ? parseFloat(p.regular_price as string)
            : null,
          stock:         (p.stock_quantity as number) ?? 0,
          position:      0,
          option1:       null,
          option2:       null,
          option3:       null,
          weight:        p.weight ? parseFloat(p.weight as string) : null,
        })
      }

      const images = ((p.images as unknown[]) ?? []).map((img, i): RawImage => {
        const im = img as Record<string, unknown>
        return {
          platformId: String(im.id),
          url:        String(im.src),
          position:   i,
          alt:        (im.alt as string) ?? null,
          width:      null,
          height:     null,
        }
      })

      const collections = ((p.categories as unknown[]) ?? []).map((cat): RawCollection => {
        const c = cat as Record<string, unknown>
        return {
          platformId: String(c.id),
          name:       String(c.name),
          slug:       (c.slug as string) ?? null,
        }
      })

      return {
        platformId:       String(p.id),
        sku:              (p.sku as string) ?? String(p.id),
        title:            String(p.name),
        description:      (p.description as string) ?? null,
        status:           (p.status as string) === 'publish' ? 'active' : 'archived',
        vendor:      null,
        productType: (p.type as string) ?? null,
        taxCode:     null,
        weight:      p.weight ? parseFloat(p.weight as string) : null,
        weightUnit:  'kg',
        variants,
        images,
        collections,
        metafields:  [],
        prices: {
          price:     p.price ? parseFloat(p.price as string) : null,
          compareAt: p.regular_price && p.sale_price
            ? parseFloat(p.regular_price as string)
            : null,
        },
      }
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Get single product
  // -------------------------------------------------------------------------

  async getProduct(platformId: string): Promise<RawProduct> {
    const p = await this.request<Record<string, unknown>>('GET', `/products/${platformId}`)
    const product = this.normalizeProduct(p)
    if (!product) throw new Error(`Failed to normalize WooCommerce product ${platformId}`)
    return product
  }

  // -------------------------------------------------------------------------
  // Create product
  //
  // Required fields for Coincart (WooCommerce / WordPress):
  //   - title (name)
  //   - description
  //   - status → 'publish' when active
  //   - categoryIds → categories array
  //   - price → regular_price (and sale_price when there is a compareAt)
  //   - stock → manage_stock=true + stock_quantity; stock_status='instock' / 'outofstock'
  //   - vendor → brand attribute (attributes: [{ name:'Brand', options:[vendor] }])
  //   - images → set separately via connector.setImages() after creation
  // -------------------------------------------------------------------------

  async createProduct(data: ProductPayload): Promise<string> {
    const attributes = data.vendor
      ? [{ name: 'Brand', visible: true, variation: false, options: [data.vendor] }]
      : []

    const body: Record<string, unknown> = {
      name:          data.title,
      description:   data.description ?? '',
      status:        data.status === 'active' ? 'publish' : 'private',
      type:          data.variants && data.variants.length > 1 ? 'variable' : 'simple',
      regular_price: data.compareAt ? data.compareAt.toString() : (data.price?.toString() ?? ''),
      sale_price:    data.compareAt && data.price ? data.price.toString() : '',
      categories:    data.categoryIds?.map((id) => ({ id: parseInt(id) })) ?? [],
      // Stock: mark as 'instock' at creation — no specific quantity.
      // Actual warehouse quantities (Ireland, Poland) are synced later by the cron via updateStock().
      stock_status:  'instock',
      attributes,
    }
    const result = await this.request<{ id: number }>('POST', '/products', body)
    return String(result.id)
  }

  // -------------------------------------------------------------------------
  // Update product
  // -------------------------------------------------------------------------

  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (data.title)                   body.name = data.title
    if (data.description !== undefined) body.description = data.description ?? ''
    if (data.status)                  body.status = data.status === 'active' ? 'publish' : 'private'
    if (data.categoryIds)             body.categories = data.categoryIds.map((id) => ({ id: parseInt(id) }))
    await this.request('PUT', `/products/${platformId}`, body)
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async deleteProduct(platformId: string): Promise<void> {
    await this.request('DELETE', `/products/${platformId}?force=true`)
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  async setImages(platformId: string, images: ImageInput[]): Promise<void> {
    const urlImages = images.filter((i) => i.type === 'url') as Array<{ type: 'url'; url: string; alt?: string }>
    await this.request('PUT', `/products/${platformId}`, {
      images: urlImages.map((img) => ({ src: img.url, alt: img.alt ?? '' })),
    })
  }

  async addImages(platformId: string, images: ImageInput[]): Promise<void> {
    const product = await this.request<{ images: Array<{ src: string; alt: string }> }>(
      'GET', `/products/${platformId}`
    )
    const urlImages = images.filter((i) => i.type === 'url') as Array<{ type: 'url'; url: string; alt?: string }>
    const combined = [
      ...product.images,
      ...urlImages.map((img) => ({ src: img.url, alt: img.alt ?? '' })),
    ]
    await this.request('PUT', `/products/${platformId}`, { images: combined })
  }

  async deleteImages(platformId: string): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, { images: [] })
  }

  // -------------------------------------------------------------------------
  // Price
  // -------------------------------------------------------------------------

  async updatePrice(platformId: string, price: number | null, compareAt?: number | null): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, {
      regular_price: compareAt ? compareAt.toString() : (price?.toString() ?? ''),
      sale_price:    compareAt && price ? price.toString() : '',
    })
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async updateStock(platformId: string, quantity: number): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, {
      manage_stock:   true,
      stock_quantity: quantity,
      in_stock:       quantity > 0,
    })
  }

  // WooCommerce batch API — 1 call per 100 products instead of 1 per product
  async bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void> {
    const BATCH = 100
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      await this.request('POST', '/products/batch', {
        update: batch.map(({ platformId, quantity }) => ({
          id:             parseInt(platformId),
          manage_stock:   true,
          stock_quantity: quantity,
        })),
      })
    }
  }

  async toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, {
      status: status === 'active' ? 'publish' : 'private',
    })
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async assignCategories(platformId: string, categoryIds: string[]): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, {
      categories: categoryIds.map((id) => ({ id: parseInt(id) })),
    })
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await this.request('GET', '/products?per_page=1')
      return { ok: true, latencyMs: Date.now() - start, error: null }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}
