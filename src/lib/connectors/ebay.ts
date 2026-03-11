import { ebayLimiter } from '@/lib/utils/rate-limiter'
import type {
  PlatformConnector,
  RawProduct,
  RawVariant,
  ProductPayload,
  HealthCheckResult,
} from './types'
import type { ImageInput } from '@/types/platform'

interface EbayTokenResponse {
  access_token: string
  expires_in: number
}

interface EbayOffer {
  offerId: string
  sku: string
  listingDescription?: string
  availableQuantity?: number
  pricingSummary?: { price?: { value?: string } }
  categoryId?: string
  merchantLocationKey?: string
  listingPolicies?: {
    fulfillmentPolicyId?: string
    paymentPolicyId?: string
    returnPolicyId?: string
  }
}

interface EbayOffersResponse {
  offers?: EbayOffer[]
}

interface EbayInventoryItem {
  sku?: string
  condition?: string
  availability?: { shipToLocationAvailability?: { quantity?: number } }
  product?: {
    title?: string
    description?: string
    imageUrls?: string[]
    ean?: string[]
  }
}

export class EbayConnector implements PlatformConnector {
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly marketplaceId = process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_IE',
    private readonly apiBase = process.env.EBAY_API_BASE_URL ?? 'https://api.ebay.com'
  ) {}

  private get identityBase(): string {
    return this.apiBase.includes('sandbox')
      ? 'https://api.sandbox.ebay.com'
      : 'https://api.ebay.com'
  }

  private get authHeader(): string {
    const raw = `${this.clientId}:${this.clientSecret}`
    const basic = typeof btoa === 'function'
      ? btoa(raw)
      : Buffer.from(raw).toString('base64')
    return `Basic ${basic}`
  }

  private async ensureAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.accessToken && now < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      scope: [
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      ].join(' '),
    })

    const res = await fetch(`${this.identityBase}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.authHeader,
      },
      body: body.toString(),
    })
    if (!res.ok) {
      throw new Error(`eBay OAuth error: ${res.status} ${await res.text()}`)
    }
    const token = await res.json() as EbayTokenResponse
    this.accessToken = token.access_token
    this.accessTokenExpiresAt = now + (token.expires_in * 1000)
    return this.accessToken
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    await ebayLimiter.throttle()
    const token = await this.ensureAccessToken()
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      throw new Error(`eBay API error: ${res.status} ${await res.text()}`)
    }
    if (res.status === 204) return {} as T
    return res.json() as Promise<T>
  }

  private effectivePrice(price: number | null, compareAt?: number | null): number | null {
    if (price != null && price > 0) return price
    if (compareAt != null && compareAt > 0) return compareAt
    return null
  }

  private async getOffer(offerId: string): Promise<EbayOffer> {
    return this.request<EbayOffer>('GET', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`)
  }

  private async findOfferBySku(sku: string): Promise<EbayOffer | null> {
    const result = await this.request<EbayOffersResponse>(
      'GET',
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(this.marketplaceId)}&format=FIXED_PRICE`,
      undefined,
      { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
    )
    return result.offers?.[0] ?? null
  }

  private async getInventoryItem(sku: string): Promise<EbayInventoryItem> {
    return this.request<EbayInventoryItem>('GET', `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`)
  }

  private buildPolicies(): { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string } {
    const fulfillmentPolicyId = process.env.EBAY_FULFILLMENT_POLICY_ID
    const paymentPolicyId = process.env.EBAY_PAYMENT_POLICY_ID
    const returnPolicyId = process.env.EBAY_RETURN_POLICY_ID
    if (!fulfillmentPolicyId || !paymentPolicyId || !returnPolicyId) {
      throw new Error('Missing eBay policy IDs: EBAY_FULFILLMENT_POLICY_ID / EBAY_PAYMENT_POLICY_ID / EBAY_RETURN_POLICY_ID')
    }
    return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId }
  }

  private buildLocationKey(): string {
    const key = process.env.EBAY_MERCHANT_LOCATION_KEY
    if (!key) throw new Error('Missing EBAY_MERCHANT_LOCATION_KEY')
    return key
  }

  private buildCategoryId(categoryIds?: string[]): string {
    if (categoryIds?.length) return categoryIds[0].replace(/^ebay_/, '')
    const fallback = process.env.EBAY_DEFAULT_CATEGORY_ID
    if (!fallback) throw new Error('Missing eBay category: set categoryIds or EBAY_DEFAULT_CATEGORY_ID')
    return fallback
  }

  private async upsertInventoryItem(sku: string, data: {
    title?: string | null
    description?: string | null
    ean?: string | null
    quantity?: number
    imageUrls?: string[]
  }): Promise<void> {
    const existing = await this.getInventoryItem(sku).catch(() => ({} as EbayInventoryItem))
    const currentQty = existing.availability?.shipToLocationAvailability?.quantity ?? 0
    const title = data.title ?? existing.product?.title ?? sku
    const description = data.description ?? existing.product?.description ?? title
    const imageUrls = data.imageUrls ?? existing.product?.imageUrls ?? []

    const payload: Record<string, unknown> = {
      condition: existing.condition ?? 'NEW',
      availability: {
        shipToLocationAvailability: {
          quantity: data.quantity ?? currentQty,
        },
      },
      product: {
        title,
        description,
        imageUrls,
      },
    }

    const ean = data.ean ?? existing.product?.ean?.[0]
    if (ean) {
      payload.product = { ...(payload.product as Record<string, unknown>), ean: [ean] }
    }

    await this.request(
      'PUT',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      payload
    )
  }

  async importProducts(): Promise<RawProduct[]> {
    // eBay import into D1 is intentionally disabled for now.
    // We only push products from D1 to eBay in this implementation.
    return []
  }

  async getProduct(platformId: string): Promise<RawProduct> {
    const offer = await this.getOffer(platformId)
    const item = await this.getInventoryItem(offer.sku)
    const price = offer.pricingSummary?.price?.value ? parseFloat(offer.pricingSummary.price.value) : null
    const qty = item.availability?.shipToLocationAvailability?.quantity ?? offer.availableQuantity ?? 0
    const variant: RawVariant = {
      platformId,
      title: null,
      sku: offer.sku,
      price,
      compareAtPrice: null,
      stock: qty,
      position: 0,
      optionName1: null,
      option1: null,
      optionName2: null,
      option2: null,
      optionName3: null,
      option3: null,
      weight: null,
    }
    return {
      platformId,
      sku: offer.sku,
      title: item.product?.title ?? offer.sku,
      description: item.product?.description ?? offer.listingDescription ?? null,
      status: 'active',
      vendor: null,
      productType: null,
      taxCode: null,
      weight: null,
      weightUnit: null,
      variants: [variant],
      images: (item.product?.imageUrls ?? []).map((url, index) => ({
        platformId: `${platformId}-${index}`,
        url,
        position: index,
        alt: null,
        width: null,
        height: null,
      })),
      collections: [],
      metafields: [],
      prices: { price, compareAt: null },
    }
  }

  async findProductIdBySku(sku: string): Promise<string | null> {
    const offer = await this.findOfferBySku(sku)
    return offer?.offerId ?? null
  }

  async createProduct(data: ProductPayload): Promise<string> {
    const sku = data.sku?.trim()
    if (!sku) throw new Error('eBay create requires SKU')
    const offerPrice = this.effectivePrice(data.price, data.compareAt)
    if (offerPrice == null) throw new Error('eBay create requires a positive price')

    await this.upsertInventoryItem(sku, {
      title: data.title,
      description: data.description,
      ean: data.ean ?? null,
      quantity: 1,
      imageUrls: [],
    })

    const policies = this.buildPolicies()
    const offer = await this.request<{ offerId: string }>('POST', '/sell/inventory/v1/offer', {
      sku,
      marketplaceId: this.marketplaceId,
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: this.buildCategoryId(data.categoryIds),
      merchantLocationKey: this.buildLocationKey(),
      listingDescription: data.description ?? data.title,
      pricingSummary: {
        price: { currency: 'EUR', value: offerPrice.toFixed(2) },
      },
      listingPolicies: policies,
    }, { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId })

    if (data.status === 'active') {
      await this.request(
        'POST',
        `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/publish`,
        {},
        { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
      )
    }

    return offer.offerId
  }

  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> {
    const offer = await this.getOffer(platformId)
    const sku = data.sku?.trim() || offer.sku
    await this.upsertInventoryItem(sku, {
      title: data.title,
      description: data.description,
      ean: data.ean ?? null,
    })
  }

  async deleteProduct(platformId: string): Promise<void> {
    await this.request('POST', `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}/withdraw`, {}, {
      'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
    }).catch(() => null)
    await this.request('DELETE', `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}`)
  }

  async setImages(platformId: string, images: ImageInput[]): Promise<void> {
    const offer = await this.getOffer(platformId)
    const imageUrls = images
      .filter((img): img is { type: 'url'; url: string; alt?: string } => img.type === 'url')
      .map((img) => img.url)
    await this.upsertInventoryItem(offer.sku, { imageUrls })
  }

  async addImages(platformId: string, images: ImageInput[]): Promise<void> {
    const offer = await this.getOffer(platformId)
    const existing = await this.getInventoryItem(offer.sku).catch(() => ({} as EbayInventoryItem))
    const current = existing.product?.imageUrls ?? []
    const extra = images
      .filter((img): img is { type: 'url'; url: string; alt?: string } => img.type === 'url')
      .map((img) => img.url)
    await this.upsertInventoryItem(offer.sku, { imageUrls: [...current, ...extra] })
  }

  async deleteImages(platformId: string): Promise<void> {
    const offer = await this.getOffer(platformId)
    await this.upsertInventoryItem(offer.sku, { imageUrls: [] })
  }

  async updatePrice(platformId: string, price: number | null, compareAt?: number | null): Promise<void> {
    const offer = await this.getOffer(platformId)
    const nextPrice = this.effectivePrice(price, compareAt)
    if (nextPrice == null) throw new Error('eBay price update requires a positive price')
    await this.request(
      'PUT',
      `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}`,
      {
        ...offer,
        pricingSummary: { price: { currency: 'EUR', value: nextPrice.toFixed(2) } },
      },
      { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
    )
  }

  async updateStock(platformId: string, quantity: number): Promise<void> {
    const offer = await this.getOffer(platformId)
    await this.upsertInventoryItem(offer.sku, { quantity: Math.max(0, quantity) })
  }

  async bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void> {
    for (const item of items) {
      await this.updateStock(item.platformId, item.quantity)
    }
  }

  async toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void> {
    if (status === 'active') {
      await this.request(
        'POST',
        `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}/publish`,
        {},
        { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
      )
      return
    }
    await this.request(
      'POST',
      `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}/withdraw`,
      {},
      { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
    )
  }

  async assignCategories(platformId: string, categoryIds: string[]): Promise<void> {
    const offer = await this.getOffer(platformId)
    const categoryId = this.buildCategoryId(categoryIds)
    await this.request(
      'PUT',
      `/sell/inventory/v1/offer/${encodeURIComponent(platformId)}`,
      { ...offer, categoryId },
      { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
    )
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await this.request(
        'GET',
        `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(this.marketplaceId)}`,
        undefined,
        { 'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId }
      )
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
