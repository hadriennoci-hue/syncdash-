import { coincartLimiter } from '@/lib/utils/rate-limiter'
import type {
  PlatformConnector, RawProduct, RawVariant, RawImage, RawCollection,
  ProductPayload, HealthCheckResult,
} from './types'
import type { ImageInput } from '@/types/platform'

export class CoincartConnector implements PlatformConnector {
  private readonly baseUrl: string

  constructor(
    private readonly siteUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    apiBaseUrl?: string
  ) {
    const trimmedApiBase = apiBaseUrl?.replace(/\/+$/, '')
    if (trimmedApiBase) {
      this.baseUrl = trimmedApiBase.endsWith('/v1/connector')
        ? trimmedApiBase
        : `${trimmedApiBase}/v1/connector`
      return
    }

    this.baseUrl = `${siteUrl.replace(/\/+$/, '')}/v1/connector`
  }

  // Coincart's backend errors on non-ASCII characters (®, ™, replacement chars, etc.).
  // Keep only printable ASCII + standard whitespace.
  private sanitizeText(text: string | null | undefined): string {
    if (!text) return ''
    return text.replace(/[^\x20-\x7E\r\n\t]/g, '').trim()
  }

  private slugify(text: string | null | undefined): string {
    return (text ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private extractPrimaryCollectionName(data: Partial<ProductPayload>): string | null {
    const fromCollections = data.collections?.find((c) => c.name?.trim())?.name?.trim() ?? null
    if (fromCollections) return fromCollections

    // Backward-compatible fallback: allow assignCategories() to pass names as "name:<collection>"
    const fromCategoryIds = data.categoryIds?.find((id) => id.startsWith('name:'))?.slice(5).trim() ?? null
    if (fromCategoryIds) return fromCategoryIds

    return null
  }

  private normalizeVariantOptionName(name: string | null | undefined, fallbackIndex: number): string {
    const trimmed = (name ?? '').trim()
    return trimmed || `Option ${fallbackIndex}`
  }

  private buildVariantWritePayload(data: Partial<ProductPayload>): {
    options?: Array<{ name: string; values: string[] }>
    variants?: Array<Record<string, unknown>>
  } {
    const variants = data.variants ?? []
    if (!variants.length) return {}

    const optionBuckets = new Map<string, Set<string>>()
    const mappedVariants = variants.map((v) => {
      const attrs: Array<{ name: string; option: string }> = []
      const optionPairs = [
        { name: this.normalizeVariantOptionName(v.optionName1, 1), value: v.option1 },
        { name: this.normalizeVariantOptionName(v.optionName2, 2), value: v.option2 },
        { name: this.normalizeVariantOptionName(v.optionName3, 3), value: v.option3 },
      ]
      for (const pair of optionPairs) {
        const value = pair.value?.trim()
        if (!value) continue
        attrs.push({ name: pair.name, option: value })
        const set = optionBuckets.get(pair.name) ?? new Set<string>()
        set.add(value)
        optionBuckets.set(pair.name, set)
      }

      const hasPromo = v.compareAt != null && v.compareAt > 0
      const basePrice = v.price ?? null
      const promoPrice = hasPromo ? v.compareAt : null

      return {
        ...(v.sku ? { sku: v.sku } : {}),
        ...(basePrice != null ? { regular_price: basePrice.toString() } : {}),
        ...(promoPrice != null ? { sale_price: promoPrice.toString() } : {}),
        stock_quantity: v.stock ?? 0,
        ...(attrs.length ? { attributes: attrs } : {}),
      }
    })

    const options = Array.from(optionBuckets.entries())
      .map(([name, values]) => ({ name, values: Array.from(values.values()) }))
      .filter((opt) => opt.values.length > 0)

    return {
      ...(options.length ? { options } : {}),
      variants: mappedVariants,
    }
  }

  private buildProductAttributesPayload(data: Partial<ProductPayload>): Array<{
    name: string
    visible: boolean
    variation: boolean
    options: string[]
  }> {
    const byName = new Map<string, { name: string; options: Set<string> }>()

    const add = (name: string, values: Array<string | null | undefined>) => {
      const normalizedName = name.trim()
      if (!normalizedName) return
      const key = normalizedName.toLowerCase()
      const entry = byName.get(key) ?? { name: normalizedName, options: new Set<string>() }
      for (const value of values) {
        const trimmed = (value ?? '').trim()
        if (!trimmed) continue
        entry.options.add(trimmed)
      }
      byName.set(key, entry)
    }

    if (data.vendor?.trim()) add('brand', [data.vendor])
    for (const [key, values] of Object.entries(data.attributeValues ?? {})) {
      add(key, values)
    }

    return Array.from(byName.values())
      .map((entry) => ({
        name: entry.name,
        visible: true,
        variation: false,
        options: Array.from(entry.options.values()),
      }))
      .filter((attr) => attr.options.length > 0)
  }

  // -------------------------------------------------------------------------
  // REST helper
  //
  // Auth via consumer_key/consumer_secret query params (not Authorization: Basic),
  // which avoids Apache intercepting the header before PHP runs.
  //
  // coincart.store's Apache blocks PUT and DELETE methods at the HTTP level,
  // returning 406 for those methods from any client. WooCommerce supports the
  // _method query parameter to tunnel PUT/DELETE via POST requests.
  // We use POST + ?_method=PUT / ?_method=DELETE for those verbs.
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    await coincartLimiter.throttle()

    // PUT and DELETE are blocked at the Apache level on coincart.store (406).
    // Tunnel them via POST using WooCommerce's _method query parameter.
    const httpMethod = (method === 'PUT' || method === 'DELETE') ? 'POST' : method
    const methodOverride = (method === 'PUT' || method === 'DELETE') ? `&_method=${method}` : ''

    const sep = path.includes('?') ? '&' : '?'
    const finalUrl = `${this.baseUrl}${path}${sep}consumer_key=${encodeURIComponent(this.consumerKey)}&consumer_secret=${encodeURIComponent(this.consumerSecret)}${methodOverride}`

    const res = await fetch(finalUrl, {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'User-Agent':   'Wizhard/1.0',
      },
      // DELETE via _method still needs a body for POST
      body: body ? JSON.stringify(body) : (method === 'DELETE' ? '{}' : undefined),
    })
    if (!res.ok) throw new Error(`Coincart error: ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }

  private async findParentProductIdBySku(sku: string): Promise<string | null> {
    const exact = await this.request<Array<{ id: number }>>(
      'GET',
      `/products?sku=${encodeURIComponent(sku)}&per_page=1&status=any`
    )
    if (exact[0]?.id) return String(exact[0].id)

    const search = await this.request<Array<{ id: number; type?: string }>>(
      'GET',
      `/products?search=${encodeURIComponent(sku)}&per_page=20&status=any`
    )
    for (const p of search) {
      if (p?.id) return String(p.id)
    }
    return null
  }

  private async findVariationIdBySku(parentId: string, sku: string): Promise<string | null> {
    let page = 1
    while (true) {
      let vars: Array<{ id: number; sku?: string | null }> = []
      try {
        vars = await this.request<Array<{ id: number; sku?: string | null }>>(
          'GET',
          `/products/${parentId}/variations?per_page=100&page=${page}`
        )
      } catch {
        // Coincart v1 connector may not expose Woo variations endpoints.
        return null
      }
      for (const v of vars) {
        if ((v.sku ?? '').trim() === sku) return String(v.id)
      }
      if (vars.length < 100) break
      page++
    }
    return null
  }

  private async resolveVariationContext(
    platformId: string,
    sku: string
  ): Promise<{ parentId: string; variationId: string } | null> {
    const parentId = await this.findParentProductIdBySku(sku)
    if (!parentId) return null
    const variationId = await this.findVariationIdBySku(parentId, sku)
    if (!variationId) return null
    return { parentId, variationId }
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
            ? parseFloat(p.sale_price as string)
            : null,
          stock:         (p.stock_quantity as number) ?? 0,
          position:      0,
          optionName1:   null,
          option1:       null,
          optionName2:   null,
          option2:       null,
          optionName3:   null,
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
            ? parseFloat(p.sale_price as string)
            : null,
          stock:         (p.stock_quantity as number) ?? 0,
          position:      0,
          optionName1:   null,
          option1:       null,
          optionName2:   null,
          option2:       null,
          optionName3:   null,
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
            ? parseFloat(p.sale_price as string)
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
    if (!product) throw new Error(`Failed to normalize Coincart product ${platformId}`)
    return product
  }

  async getProductUpdatedAt(platformId: string): Promise<string | null> {
    const p = await this.request<Record<string, unknown>>('GET', `/products/${platformId}`)
    const updated = (p.date_modified_gmt as string | undefined) ?? (p.date_modified as string | undefined)
    return updated ?? null
  }

  async findProductIdBySku(sku: string): Promise<string | null> {
    const items = await this.request<Array<{ id: number }>>(
      'GET',
      `/products?sku=${encodeURIComponent(sku)}&per_page=1&status=any`
    )
    if (items[0]?.id) return String(items[0].id)

    const search = await this.request<Array<{ id: number }>>(
      'GET',
      `/products?search=${encodeURIComponent(sku)}&per_page=20&status=any`
    )
    return search[0]?.id ? String(search[0].id) : null
  }

  async findProductIdByExactSlug(slug: string): Promise<string | null> {
    if (!slug) return null
    const results = await this.request<Array<{ id: number; slug?: string | null }>>(
      'GET',
      `/products?slug=${encodeURIComponent(slug)}&per_page=5&status=any`
    )
    const exact = results.find((item) => (item.slug ?? '').trim() === slug)
    return exact?.id ? String(exact.id) : null
  }

  async findProductIdBySlugOrTitle(title: string): Promise<string | null> {
    const slug = this.slugify(title)
    if (!slug) return null

    const bySlug = await this.request<Array<{ id: number; slug?: string | null }>>(
      'GET',
      `/products?slug=${encodeURIComponent(slug)}&per_page=20&status=any`
    )
    const exactSlug = bySlug.find((item) => (item.slug ?? '').trim() === slug)
    if (exactSlug?.id) return String(exactSlug.id)

    const byTitle = await this.request<Array<{ id: number; slug?: string | null; name?: string | null }>>(
      'GET',
      `/products?search=${encodeURIComponent(title)}&per_page=20&status=any`
    )
    const exactTitle = byTitle.find((item) => this.slugify(item.name) === slug || (item.slug ?? '').trim() === slug)
    if (exactTitle?.id) return String(exactTitle.id)

    return null
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
    const attributes = this.buildProductAttributesPayload(data)

    const primaryCollection = this.extractPrimaryCollectionName(data)
    const body: Record<string, unknown> = {
      name:          this.sanitizeText(data.title),
      description:   this.sanitizeText(data.description),
      status:        data.status === 'active' ? 'publish' : 'private',
      type:          data.variants && data.variants.length > 1 ? 'variable' : 'simple',
      sku:           data.sku ?? '',
      regular_price: data.price?.toString() ?? '',
      sale_price:    data.compareAt ? data.compareAt.toString() : '',
      ...(primaryCollection ? { category: primaryCollection } : {}),
      // Stock: mark as 'instock' at creation — no specific quantity.
      // Actual warehouse quantities (Ireland, Poland) are synced later by the cron via updateStock().
      stock_status:  'instock',
      attributes,
    }
    const explicitSlug = this.slugify(data.slug)
    if (explicitSlug) body.slug = explicitSlug
    const variantPayload = this.buildVariantWritePayload(data)
    if (variantPayload.options) body.options = variantPayload.options
    if (variantPayload.variants) body.variants = variantPayload.variants
    if (data.ean) {
      body.meta_data = [{ key: 'ean', value: data.ean }]
    }
    const result = await this.request<{ id: number }>('POST', '/products', body)
    return String(result.id)
  }

  // -------------------------------------------------------------------------
  // Update product
  // -------------------------------------------------------------------------

  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (data.title)                   body.name = this.sanitizeText(data.title)
    if (data.description !== undefined) body.description = this.sanitizeText(data.description)
    if (data.status)                  body.status = data.status === 'active' ? 'publish' : 'private'
    if (data.sku)                     body.sku = data.sku
    const primaryCollection = this.extractPrimaryCollectionName(data)
    if (primaryCollection)            body.category = primaryCollection
    if (data.ean)                     body.meta_data = [{ key: 'ean', value: data.ean }]
    if (data.vendor || data.attributeValues) body.attributes = this.buildProductAttributesPayload(data)
    const variantPayload = this.buildVariantWritePayload(data)
    if (variantPayload.options)       body.options = variantPayload.options
    if (variantPayload.variants)      body.variants = variantPayload.variants
    if (data.replaceVariants !== undefined) body.replace_variants = !!data.replaceVariants
    await this.request('PUT', `/products/${platformId}`, body)
  }

  async updateProductForSku(platformId: string, sku: string, data: Partial<ProductPayload>): Promise<void> {
    const ctx = await this.resolveVariationContext(platformId, sku)
    const targetId = ctx?.parentId ?? platformId
    await this.updateProduct(targetId, data)
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
      regular_price: price?.toString() ?? '',
      sale_price:    compareAt ? compareAt.toString() : '',
    })
  }

  async updatePriceForSku(platformId: string, sku: string, price: number | null, compareAt?: number | null): Promise<void> {
    const ctx = await this.resolveVariationContext(platformId, sku)
    if (!ctx) {
      await this.updatePrice(platformId, price, compareAt)
      return
    }
    await this.request('PUT', `/products/${ctx.parentId}/variations/${ctx.variationId}`, {
      regular_price: price?.toString() ?? '',
      sale_price:    compareAt ? compareAt.toString() : '',
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

  async updateStockForSku(platformId: string, sku: string, quantity: number): Promise<void> {
    const ctx = await this.resolveVariationContext(platformId, sku)
    if (!ctx) {
      await this.updateStock(platformId, quantity)
      return
    }
    await this.request('PUT', `/products/${ctx.parentId}/variations/${ctx.variationId}`, {
      manage_stock:   true,
      stock_quantity: quantity,
      in_stock:       quantity > 0,
    })
  }

  // Coincart batch API — 1 call per 100 products instead of 1 per product
  async bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void> {
    const BATCH = 100
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH)
      await this.request('POST', '/products/batch', {
        update: batch.map(({ platformId, quantity }) => ({
          id:             platformId,
          manage_stock:   true,
          stock_quantity: quantity,
        })),
      })
    }
  }

  async bulkSetStockForSkus(items: Array<{ platformId: string; sku: string; quantity: number }>): Promise<void> {
    const simple: Array<{ platformId: string; quantity: number }> = []
    for (const item of items) {
      const ctx = await this.resolveVariationContext(item.platformId, item.sku)
      if (!ctx) {
        simple.push({ platformId: item.platformId, quantity: item.quantity })
        continue
      }
      await this.request('PUT', `/products/${ctx.parentId}/variations/${ctx.variationId}`, {
        manage_stock:   true,
        stock_quantity: item.quantity,
        in_stock:       item.quantity > 0,
      })
    }
    if (simple.length > 0) {
      await this.bulkSetStock(simple)
    }
  }

  async listProductsForZeroing(): Promise<Array<{ platformId: string; sku: string | null; updatedAt: string | null }>> {
    const out: Array<{ platformId: string; sku: string | null; updatedAt: string | null }> = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const items = await this.request<Array<{
        id: number
        sku?: string | null
        date_modified_gmt?: string | null
        date_modified?: string | null
      }>>('GET', `/products?per_page=100&page=${page}&status=any&_fields=id,sku,date_modified_gmt,date_modified`)

      for (const item of items) {
        out.push({
          platformId: String(item.id),
          sku: item.sku ?? null,
          updatedAt: item.date_modified_gmt ?? item.date_modified ?? null,
        })
      }
      hasMore = items.length === 100
      page++
    }

    return out
  }

  async toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void> {
    await this.request('PUT', `/products/${platformId}`, {
      status: status === 'active' ? 'publish' : 'private',
    })
  }

  async toggleStatusForSku(platformId: string, sku: string, status: 'active' | 'archived'): Promise<void> {
    const ctx = await this.resolveVariationContext(platformId, sku)
    const targetId = ctx?.parentId ?? platformId
    await this.toggleStatus(targetId, status)
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async assignCategories(platformId: string, categoryIds: string[]): Promise<void> {
    const primaryCollection = categoryIds.find((id) => id.startsWith('name:'))?.slice(5).trim()
    if (!primaryCollection) return
    await this.request('PUT', `/products/${platformId}`, {
      category: primaryCollection,
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
