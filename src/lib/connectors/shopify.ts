import { shopifyLimiter } from '@/lib/utils/rate-limiter'
import type {
  PlatformConnector, RawProduct, RawVariant, RawImage, RawCollection,
  RawMetafield, ProductPayload, HealthCheckResult,
} from './types'
import type { ImageInput } from '@/types/platform'

// Shopify standard product taxonomy GID for "Electronics" — used for tax classification.
// See: https://help.shopify.com/en/manual/products/details/product-category
const SHOPIFY_ELECTRONICS_CATEGORY_GID = 'gid://shopify/TaxonomyCategory/el'

export class ShopifyConnector implements PlatformConnector {
  private readonly baseUrl: string

  constructor(
    private readonly shop: string,
    private readonly token: string,
    // Optional: the Shopify location ID used when pushing inventory quantities.
    // If omitted, updateStock() will use the shop's primary location.
    private readonly locationId?: string
  ) {
    this.baseUrl = `https://${shop}/admin/api/2024-01`
  }

  // -------------------------------------------------------------------------
  // GraphQL helper
  // -------------------------------------------------------------------------

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    await shopifyLimiter.throttle()
    const res = await fetch(`${this.baseUrl}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.token,
        'User-Agent': 'Wizhard/1.0',
      },
      body: JSON.stringify({ query, variables }),
      // @ts-ignore — Cloudflare Workers cf option: bypass Cloudflare edge rules
      cf: { cacheEverything: false },
    })
    if (!res.ok) throw new Error(`Shopify GraphQL error: ${res.status} ${await res.text()}`)
    const json = await res.json() as { data?: T; errors?: unknown[] }
    if (json.errors?.length) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`)
    return json.data as T
  }

  // -------------------------------------------------------------------------
  // Import (paginated)
  // -------------------------------------------------------------------------

  async importProducts(): Promise<RawProduct[]> {
    const products: RawProduct[] = []
    let cursor: string | null = null
    let hasNextPage = true

    while (hasNextPage) {
      const query = `
        query Products($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id title descriptionHtml status vendor productType
              collections(first: 20) { nodes { id title handle } }
              metafields(first: 50) { nodes { namespace key value type } }
              variants(first: 50) {
                nodes {
                  id title sku price compareAtPrice inventoryQuantity position weight
                  selectedOptions { name value }
                }
              }
              images(first: 20) {
                nodes { id url altText width height position }
              }
            }
          }
        }
      `
      const data = await this.graphql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: unknown[] } }>(
        query,
        { cursor }
      )

      for (const node of data.products.nodes) {
        const product = this.normalizeProduct(node as Record<string, unknown>)
        if (product) products.push(product)
      }

      hasNextPage = data.products.pageInfo.hasNextPage
      cursor = data.products.pageInfo.endCursor
    }

    return products
  }

  private normalizeProduct(node: Record<string, unknown>): RawProduct | null {
    try {
      const variants = (node.variants as { nodes: unknown[] }).nodes.map(
        (v): RawVariant => {
          const vn = v as Record<string, unknown>
          const opts = (vn.selectedOptions as Array<{ name: string; value: string }>) ?? []
          return {
            platformId:   String(vn.id),
            title:        (vn.title as string) ?? null,
            sku:          (vn.sku as string) ?? null,
            price:        vn.price ? parseFloat(vn.price as string) : null,
            compareAtPrice: vn.compareAtPrice ? parseFloat(vn.compareAtPrice as string) : null,
            stock:        (vn.inventoryQuantity as number) ?? 0,
            position:     (vn.position as number) ?? 0,
            option1:      opts[0]?.value ?? null,
            option2:      opts[1]?.value ?? null,
            option3:      opts[2]?.value ?? null,
            weight:       (vn.weight as number) ?? null,
          }
        }
      )

      const images = (node.images as { nodes: unknown[] }).nodes.map(
        (i): RawImage => {
          const img = i as Record<string, unknown>
          return {
            platformId: String(img.id),
            url:        String(img.url),
            position:   (img.position as number) ?? 0,
            alt:        (img.altText as string) ?? null,
            width:      (img.width as number) ?? null,
            height:     (img.height as number) ?? null,
          }
        }
      )

      const collections = (node.collections as { nodes: unknown[] }).nodes.map(
        (c): RawCollection => {
          const col = c as Record<string, unknown>
          return {
            platformId: String(col.id),
            name:       String(col.title),
            slug:       (col.handle as string) ?? null,
          }
        }
      )

      const metafields = (node.metafields as { nodes: unknown[] }).nodes.map(
        (m): RawMetafield => {
          const mf = m as Record<string, unknown>
          return {
            namespace: String(mf.namespace),
            key:       String(mf.key),
            value:     (mf.value as string) ?? null,
            type:      (mf.type as string) ?? null,
          }
        }
      )

      const firstVariant = variants[0]

      return {
        platformId:  String(node.id),
        sku:         (firstVariant?.sku ?? String(node.id)),
        title:       String(node.title),
        description:      (node.descriptionHtml as string) ?? null,
        status:           (node.status as string)?.toLowerCase() === 'active' ? 'active' : 'archived',
        vendor:      (node.vendor as string) ?? null,
        productType: (node.productType as string) ?? null,
        taxCode:     null, // metafield lookup if needed
        weight:      null,
        weightUnit:  null,
        variants,
        images,
        collections,
        metafields,
        prices: {
          price:     firstVariant?.price ?? null,
          compareAt: firstVariant?.compareAtPrice ?? null,
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
    const query = `
      query Product($id: ID!) {
        product(id: $id) {
          id title descriptionHtml status vendor productType
          variants(first: 50) { nodes { id title sku price compareAtPrice inventoryQuantity position weight selectedOptions { name value } } }
          images(first: 20) { nodes { id url altText width height position } }
          collections(first: 20) { nodes { id title handle } }
          metafields(first: 50) { nodes { namespace key value type } }
        }
      }
    `
    const data = await this.graphql<{ product: unknown }>(query, { id: platformId })
    const product = this.normalizeProduct(data.product as Record<string, unknown>)
    if (!product) throw new Error(`Failed to normalize product ${platformId}`)
    return product
  }

  // -------------------------------------------------------------------------
  // Create product
  // -------------------------------------------------------------------------

  async createProduct(data: ProductPayload): Promise<string> {
    const mutation = `
      mutation CreateProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }
    `
    const input: Record<string, unknown> = {
      title:           data.title,
      descriptionHtml: data.description ?? '',
      status:          data.status.toUpperCase(),
      vendor:          data.vendor,
      productType:     data.productType,
      variants:        data.variants?.map((v) => ({
        title:           v.title,
        sku:             v.sku,
        price:           v.price?.toString(),
        compareAtPrice:  v.compareAt?.toString(),
        inventoryQuantities: [{ availableQuantity: v.stock, locationId: '' }],
      })) ?? [],
    }
    // Shopify product taxonomy category (used for tax classification).
    // Defaults to Electronics. Override via data.shopifyCategory if needed.
    input.productCategory = {
      productTaxonomyNodeId: data.shopifyCategory ?? SHOPIFY_ELECTRONICS_CATEGORY_GID,
    }
    const result = await this.graphql<{ productCreate: { product: { id: string }; userErrors: Array<{ message: string }> } }>(
      mutation,
      { input }
    )
    if (result.productCreate.userErrors.length > 0) {
      throw new Error(result.productCreate.userErrors.map((e) => e.message).join(', '))
    }
    return result.productCreate.product.id
  }

  // -------------------------------------------------------------------------
  // Update product
  // -------------------------------------------------------------------------

  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> {
    const mutation = `
      mutation UpdateProduct($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }
    `
    const input: Record<string, unknown> = { id: platformId }
    if (data.title)       input.title = data.title
    if (data.description !== undefined) input.descriptionHtml = data.description ?? ''
    if (data.status)      input.status = data.status.toUpperCase()
    if (data.vendor)      input.vendor = data.vendor

    const result = await this.graphql<{ productUpdate: { userErrors: Array<{ message: string }> } }>(
      mutation, { input }
    )
    if (result.productUpdate.userErrors.length > 0) {
      throw new Error(result.productUpdate.userErrors.map((e) => e.message).join(', '))
    }
  }

  // -------------------------------------------------------------------------
  // Delete product
  // -------------------------------------------------------------------------

  async deleteProduct(platformId: string): Promise<void> {
    const mutation = `
      mutation DeleteProduct($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors { field message }
        }
      }
    `
    await this.graphql(mutation, { input: { id: platformId } })
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  async setImages(platformId: string, images: ImageInput[]): Promise<void> {
    await this.deleteImages(platformId)
    await this.addImages(platformId, images)
  }

  async addImages(platformId: string, images: ImageInput[]): Promise<void> {
    const urlImages = images.filter((i) => i.type === 'url') as Array<{ type: 'url'; url: string; alt?: string }>
    if (urlImages.length === 0) return

    const mutation = `
      mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { ... on MediaImage { id } }
          mediaUserErrors { field message }
        }
      }
    `
    const media = urlImages.map((img) => ({
      originalSource: img.url,
      alt:            img.alt ?? '',
      mediaContentType: 'IMAGE',
    }))
    await this.graphql(mutation, { productId: platformId, media })
  }

  async deleteImages(platformId: string): Promise<void> {
    const query = `
      query ProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 50) { nodes { id } }
        }
      }
    `
    const data = await this.graphql<{ product: { media: { nodes: Array<{ id: string }> } } }>(
      query, { id: platformId }
    )
    const mediaIds = data.product.media.nodes.map((n) => n.id)
    if (mediaIds.length === 0) return

    const mutation = `
      mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          mediaUserErrors { field message }
        }
      }
    `
    await this.graphql(mutation, { productId: platformId, mediaIds })
  }

  // -------------------------------------------------------------------------
  // Price
  // -------------------------------------------------------------------------

  async updatePrice(platformId: string, price: number | null, compareAt?: number | null): Promise<void> {
    // Price is set per variant — get first variant
    const query = `query { product(id: "${platformId}") { variants(first: 1) { nodes { id } } } }`
    const data = await this.graphql<{ product: { variants: { nodes: Array<{ id: string }> } } }>(query)
    const variantId = data.product.variants.nodes[0]?.id
    if (!variantId) return

    const mutation = `
      mutation UpdateVariant($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant { id }
          userErrors { field message }
        }
      }
    `
    await this.graphql(mutation, {
      input: {
        id:            variantId,
        price:         price?.toString(),
        compareAtPrice: compareAt?.toString() ?? null,
      },
    })
  }

  // -------------------------------------------------------------------------
  // Stock
  // -------------------------------------------------------------------------

  async updateStock(platformId: string, quantity: number): Promise<void> {
    // Step 1 — resolve which location to use
    let locationGid = this.locationId
    if (!locationGid) {
      const locQuery = `{ shop { primaryDomain { url } } locations(first: 1) { nodes { id } } }`
      const locData = await this.graphql<{ locations: { nodes: Array<{ id: string }> } }>(locQuery)
      locationGid = locData.locations.nodes[0]?.id
      if (!locationGid) throw new Error('No Shopify location found for inventory update')
    }

    // Step 2 — get the first variant's inventoryItem GID
    const itemQuery = `
      query GetInventoryItem($id: ID!) {
        product(id: $id) {
          variants(first: 1) { nodes { inventoryItem { id } } }
        }
      }
    `
    const itemData = await this.graphql<{
      product: { variants: { nodes: Array<{ inventoryItem: { id: string } }> } }
    }>(itemQuery, { id: platformId })
    const inventoryItemId = itemData.product.variants.nodes[0]?.inventoryItem?.id
    if (!inventoryItemId) throw new Error(`No inventory item found for product ${platformId}`)

    // Step 3 — set on-hand quantity
    const mutation = `
      mutation SetInventory($input: InventorySetOnHandQuantitiesInput!) {
        inventorySetOnHandQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `
    const result = await this.graphql<{
      inventorySetOnHandQuantities: { userErrors: Array<{ message: string }> }
    }>(mutation, {
      input: {
        reason: 'correction',
        setQuantities: [{ inventoryItemId, locationId: locationGid, quantity }],
      },
    })
    if (result.inventorySetOnHandQuantities.userErrors.length > 0) {
      throw new Error(result.inventorySetOnHandQuantities.userErrors.map((e) => e.message).join(', '))
    }
  }

  // Bulk-set stock: resolve all inventory items in one nodes() query per 50 products,
  // then set quantities in one inventorySetOnHandQuantities mutation per 250 items.
  // This replaces 3N individual API calls with ~ceil(N/50) + ceil(N/250) calls.
  async bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void> {
    if (items.length === 0) return

    // Resolve location once
    let locationGid = this.locationId
    if (!locationGid) {
      const locData = await this.graphql<{ locations: { nodes: Array<{ id: string }> } }>(
        `{ locations(first: 1) { nodes { id } } }`
      )
      locationGid = locData.locations.nodes[0]?.id
      if (!locationGid) throw new Error('No Shopify location found')
    }

    // Batch-resolve inventory item IDs from product GIDs (50 per query)
    const QUERY_BATCH = 50
    const setQuantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = []

    for (let i = 0; i < items.length; i += QUERY_BATCH) {
      const batch = items.slice(i, i + QUERY_BATCH)
      const ids   = batch.map((b) => b.platformId)

      const query = `
        query InventoryItems($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              variants(first: 1) { nodes { inventoryItem { id } } }
            }
          }
        }
      `
      const data = await this.graphql<{
        nodes: Array<{ id?: string; variants?: { nodes: Array<{ inventoryItem: { id: string } }> } } | null>
      }>(query, { ids })

      for (const node of data.nodes) {
        if (!node?.id || !node.variants) continue
        const inventoryItemId = node.variants.nodes[0]?.inventoryItem?.id
        if (!inventoryItemId) continue
        const item = batch.find((b) => b.platformId === node.id)
        if (!item) continue
        setQuantities.push({ inventoryItemId, locationId: locationGid, quantity: item.quantity })
      }
    }

    if (setQuantities.length === 0) return

    // Set all quantities in batches of 250
    const MUTATION_BATCH = 250
    const mutation = `
      mutation SetInventory($input: InventorySetOnHandQuantitiesInput!) {
        inventorySetOnHandQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `
    for (let i = 0; i < setQuantities.length; i += MUTATION_BATCH) {
      const batch  = setQuantities.slice(i, i + MUTATION_BATCH)
      const result = await this.graphql<{
        inventorySetOnHandQuantities: { userErrors: Array<{ message: string }> }
      }>(mutation, { input: { reason: 'correction', setQuantities: batch } })
      if (result.inventorySetOnHandQuantities.userErrors.length > 0) {
        throw new Error(result.inventorySetOnHandQuantities.userErrors.map((e) => e.message).join(', '))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void> {
    await this.updateProduct(platformId, { status })
  }

  // -------------------------------------------------------------------------
  // Categories (collections)
  // -------------------------------------------------------------------------

  async assignCategories(_platformId: string, _categoryIds: string[]): Promise<void> {
    // Shopify: collections are managed separately (collects)
    // Implementation depends on collection type (smart vs manual)
    // TODO: implement via collectionAddProducts mutation
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const query = `{ shop { name } }`
      await this.graphql(query)
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

// ---------------------------------------------------------------------------
// Shopify Warehouse Connector — reads stock from a Shopify location
// ---------------------------------------------------------------------------

export class ShopifyWarehouseConnector {
  private readonly baseUrl: string

  constructor(
    private readonly shop: string,
    private readonly token: string,
    private readonly locationId: string
  ) {
    this.baseUrl = `https://${shop}/admin/api/2024-01`
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    await shopifyLimiter.throttle()
    const res = await fetch(`${this.baseUrl}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.token,
        'User-Agent': 'Wizhard/1.0',
      },
      body: JSON.stringify({ query, variables }),
      // @ts-ignore — Cloudflare Workers cf option: bypass Cloudflare edge rules
      cf: { cacheEverything: false },
    })
    if (!res.ok) throw new Error(`Shopify error: ${res.status}`)
    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors?.length) throw new Error(`Shopify GraphQL error: ${json.errors[0].message}`)
    if (!json.data) throw new Error('Shopify GraphQL returned no data')
    return json.data
  }

  async getStock() {
    const snapshots: Array<{ sku: string; quantity: number; sourceName?: string }> = []
    let cursor: string | null = null
    let hasNext = true

    while (hasNext) {
      const query = `
        query InventoryItems($cursor: String, $locationId: ID!) {
          inventoryItems(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              sku
              variant { product { title } }
              inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { quantity } }
            }
          }
        }
      `
      const data = await this.graphql<{
        inventoryItems: {
          pageInfo: { hasNextPage: boolean; endCursor: string }
          nodes: Array<{
            sku: string
            variant: { product: { title: string } } | null
            inventoryLevel: { quantities: Array<{ quantity: number }> } | null
          }>
        }
      }>(query, { cursor, locationId: this.locationId })

      for (const item of data.inventoryItems.nodes) {
        if (item.sku) {
          const qty = item.inventoryLevel?.quantities[0]?.quantity ?? 0
          snapshots.push({
            sku: item.sku,
            quantity: qty,
            sourceName: item.variant?.product?.title ?? undefined,
          })
        }
      }

      hasNext = data.inventoryItems.pageInfo.hasNextPage
      cursor = data.inventoryItems.pageInfo.endCursor
    }

    return snapshots
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await this.graphql(`{ shop { name } }`)
      return { ok: true, latencyMs: Date.now() - start, error: null }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Unknown' }
    }
  }
}
