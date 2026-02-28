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
    this.baseUrl = `https://${shop}/admin/api/2025-01`
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

  private async rest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<T> {
    await shopifyLimiter.throttle()
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.token,
        'User-Agent': 'Wizhard/1.0',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      // @ts-ignore
      cf: { cacheEverything: false },
    })
    if (!res.ok) throw new Error(`Shopify REST error: ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }

  private gidToNumericId(gid: string): number {
    const n = Number(gid.split('/').pop() ?? '')
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid Shopify GID: ${gid}`)
    return n
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
                  id title sku price compareAtPrice inventoryQuantity position
                  selectedOptions { name value }
                }
              }
              images(first: 20) {
                nodes { id url altText width height }
              }
            }
          }
        }
      `
      const gqlResponse: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: unknown[] } } = await this.graphql(
        query,
        { cursor }
      )

      for (const node of gqlResponse.products.nodes) {
        const product = this.normalizeProduct(node as Record<string, unknown>)
        if (product) products.push(product)
      }

      hasNextPage = gqlResponse.products.pageInfo.hasNextPage
      cursor = gqlResponse.products.pageInfo.endCursor
    }

    return products
  }

  private normalizeProduct(node: Record<string, unknown>): RawProduct | null {
    try {
      const variants = (node.variants as { nodes: unknown[] }).nodes.map(
        (v): RawVariant => {
          const vn = v as Record<string, unknown>
          const opts = (vn.selectedOptions as Array<{ name: string; value: string }>) ?? []
          const rawPrice = vn.price ? parseFloat(vn.price as string) : null
          const rawCompareAt = vn.compareAtPrice ? parseFloat(vn.compareAtPrice as string) : null
          const hasPromo = rawCompareAt != null && rawCompareAt > 0
          const basePrice = hasPromo ? rawCompareAt : rawPrice
          const promoPrice = hasPromo ? rawPrice : null
          return {
            platformId:   String(vn.id),
            title:        (vn.title as string) ?? null,
            sku:          (vn.sku as string) ?? null,
            price:        basePrice ?? null,
            compareAtPrice: promoPrice ?? null,
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
          variants(first: 50) { nodes { id title sku price compareAtPrice inventoryQuantity position selectedOptions { name value } } }
          images(first: 20) { nodes { id url altText width height } }
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

  async getProductUpdatedAt(platformId: string): Promise<string | null> {
    const query = `
      query ProductUpdatedAt($id: ID!) {
        product(id: $id) { updatedAt }
      }
    `
    const data = await this.graphql<{ product: { updatedAt?: string } | null }>(query, { id: platformId })
    return data.product?.updatedAt ?? null
  }

  async findProductIdBySku(sku: string): Promise<string | null> {
    const query = `
      query ProductIdBySku($q: String!) {
        productVariants(first: 1, query: $q) {
          nodes {
            product { id }
          }
        }
      }
    `
    const data = await this.graphql<{
      productVariants: { nodes: Array<{ product?: { id?: string } }> }
    }>(query, { q: `sku:"${sku}"` })
    return data.productVariants.nodes[0]?.product?.id ?? null
  }

  // -------------------------------------------------------------------------
  // Create product
  // -------------------------------------------------------------------------

  private async updateVariantIdentity(
    variantId: string,
    identity: { sku?: string | null; barcode?: string | null }
  ): Promise<void> {
    if (!identity.sku && !identity.barcode) return
    const numericId = this.gidToNumericId(variantId)
    await this.rest('PUT', `/variants/${numericId}.json`, {
      variant: {
        id: numericId,
        ...(identity.sku ? { sku: identity.sku } : {}),
        ...(identity.barcode ? { barcode: identity.barcode } : {}),
      },
    })
  }

  async createProduct(data: ProductPayload): Promise<string> {
    // Shopify 2024-04+ new product API: ProductCreateInput
    // - no variants field (Shopify auto-creates a default variant)
    // - category is the taxonomy node GID directly (not ProductCategoryInput wrapper)
    const createMutation = `
      mutation CreateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) { nodes { id } }
          }
          userErrors { field message }
        }
      }
    `
    const productInput: Record<string, unknown> = {
      title:           data.title,
      descriptionHtml: data.description ?? '',
      status:          data.status.toUpperCase(),
      // Shopify product taxonomy category (tax classification). Always Electronics.
      category:        data.shopifyCategory ?? SHOPIFY_ELECTRONICS_CATEGORY_GID,
    }
    if (data.vendor)      productInput.vendor = data.vendor
    if (data.productType) productInput.productType = data.productType

    const result = await this.graphql<{
      productCreate: {
        product: { id: string; variants: { nodes: Array<{ id: string }> } } | null
        userErrors: Array<{ message: string }>
      }
    }>(createMutation, { product: productInput })

    if (result.productCreate.userErrors.length > 0) {
      throw new Error(result.productCreate.userErrors.map((e) => e.message).join(', '))
    }

    const productId       = result.productCreate.product!.id
    const defaultVariantId = result.productCreate.product!.variants.nodes[0]?.id

    // Set price and enable inventory tracking on the auto-created default variant.
    // inventoryItem.tracked must be true or inventorySetOnHandQuantities silently does nothing.
    if (defaultVariantId) {
      const variantMutation = `
        mutation UpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }
      `
      const variantInput: Record<string, unknown> = {
        id:            defaultVariantId,
        inventoryItem: { tracked: true },
      }
      if (data.ean) variantInput.barcode = data.ean
      const hasPromo = data.compareAt != null && data.compareAt > 0
      const basePrice = data.price
      const promoPrice = hasPromo ? data.compareAt : null
      if (promoPrice != null) {
        variantInput.price = promoPrice.toString()
        variantInput.compareAtPrice = (basePrice ?? promoPrice).toString()
      } else if (basePrice != null) {
        variantInput.price = basePrice.toString()
        variantInput.compareAtPrice = null
      }

      const varUpdate = await this.graphql<{
        productVariantsBulkUpdate: { userErrors: Array<{ message: string }> }
      }>(variantMutation, { productId, variants: [variantInput] })
      if (varUpdate.productVariantsBulkUpdate.userErrors.length > 0) {
        throw new Error(varUpdate.productVariantsBulkUpdate.userErrors.map((e) => e.message).join(', '))
      }

      // Some stores reject SKU in ProductVariantsBulkInput. Set SKU/EAN in a dedicated call.
      await this.updateVariantIdentity(defaultVariantId, {
        sku: data.sku ?? null,
        barcode: data.ean ?? null,
      }).catch(() => {})
    }

    return productId
  }

  // -------------------------------------------------------------------------
  // Update product
  // -------------------------------------------------------------------------

  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> {
    // Shopify schema on this store expects productUpdate(product: ProductUpdateInput!)
    // with product.id inside the input.
    const mutation = `
      mutation UpdateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id }
          userErrors { field message }
        }
      }
    `
    const productInput: Record<string, unknown> = { id: platformId }
    if (data.title)                     productInput.title = data.title
    if (data.description !== undefined) productInput.descriptionHtml = data.description ?? ''
    if (data.status)                    productInput.status = data.status.toUpperCase()
    if (data.vendor)                    productInput.vendor = data.vendor

    const result = await this.graphql<{ productUpdate: { userErrors: Array<{ message: string }> } }>(
      mutation, { product: productInput }
    )
    if (result.productUpdate.userErrors.length > 0) {
      throw new Error(result.productUpdate.userErrors.map((e) => e.message).join(', '))
    }

    // EAN lives on the variant; keep SKU unchanged for existing products.
    if (data.ean || data.sku) {
      const variantQuery = `
        query ProductVariant($id: ID!) {
          product(id: $id) { variants(first: 1) { nodes { id } } }
        }
      `
      const variantData = await this.graphql<{ product: { variants: { nodes: Array<{ id: string }> } } }>(
        variantQuery,
        { id: platformId }
      )
      const variantId = variantData.product.variants.nodes[0]?.id
      if (variantId) {
        await this.updateVariantIdentity(variantId, {
          sku: data.sku ?? null,
          barcode: data.ean ?? null,
        }).catch(() => {})
      }
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

    const numericId = this.gidToNumericId(variantId)
    const hasPromo = compareAt != null && compareAt > 0
    const basePrice = price
    const promoPrice = hasPromo ? compareAt : null
    await this.rest('PUT', `/variants/${numericId}.json`, {
      variant: {
        id: numericId,
        price: promoPrice != null ? promoPrice.toString() : (basePrice?.toString() ?? null),
        compare_at_price: promoPrice != null ? (basePrice ?? promoPrice).toString() : null,
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

  async listProductsForZeroing(): Promise<Array<{ platformId: string; sku: string | null; updatedAt: string | null }>> {
    const out: Array<{ platformId: string; sku: string | null; updatedAt: string | null }> = []
    let cursor: string | null = null
    let hasNext = true

    while (hasNext) {
      const query = `
        query ProductsForZero($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              updatedAt
              variants(first: 1) { nodes { sku } }
            }
          }
        }
      `
      const gqlResponse: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string }
          nodes: Array<{ id: string; updatedAt?: string; variants?: { nodes?: Array<{ sku?: string | null }> } }>
        }
      } = await this.graphql(query, { cursor })

      for (const n of gqlResponse.products.nodes) {
        out.push({
          platformId: n.id,
          sku: n.variants?.nodes?.[0]?.sku ?? null,
          updatedAt: n.updatedAt ?? null,
        })
      }
      hasNext = gqlResponse.products.pageInfo.hasNextPage
      cursor = gqlResponse.products.pageInfo.endCursor
    }

    return out
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
    // Shopify: collections are managed separately (collects). Use syncCollectionsToProduct().
    return
  }

  // -------------------------------------------------------------------------
  // Collections (manual collections for Komputerzz sync)
  // -------------------------------------------------------------------------

  private async findCollectionByHandle(handle: string): Promise<{ id: string; title: string; handle: string } | null> {
    const query = `
      query CollectionByHandle($handle: String!) {
        collectionByHandle(handle: $handle) { id title handle }
      }
    `
    const data = await this.graphql<{ collectionByHandle: { id: string; title: string; handle: string } | null }>(
      query,
      { handle }
    )
    return data.collectionByHandle ?? null
  }

  private async createCustomCollection(title: string, handle: string): Promise<{ id: string; title: string; handle: string }> {
    // REST is simplest for manual collections.
    const res = await this.rest<{ custom_collection: { id: number; title: string; handle: string } }>('POST', `/custom_collections.json`, {
      custom_collection: { title, handle },
    })
    return {
      id: `gid://shopify/Collection/${res.custom_collection.id}`,
      title: res.custom_collection.title,
      handle: res.custom_collection.handle,
    }
  }

  private async addProductToCollection(productGid: string, collectionGid: string): Promise<void> {
    const productId = this.gidToNumericId(productGid)
    const collectionId = this.gidToNumericId(collectionGid)
    await this.rest('POST', `/collects.json`, {
      collect: { product_id: productId, collection_id: collectionId },
    })
  }

  async syncCollectionsToProduct(
    productGid: string,
    collections: Array<{ title: string; handle: string }>
  ): Promise<void> {
    for (const col of collections) {
      if (!col.handle) continue
      let existing = await this.findCollectionByHandle(col.handle)
      if (!existing) {
        try {
          existing = await this.createCustomCollection(col.title, col.handle)
        } catch {
          // If handle already exists (race or handle normalization), try lookup again.
          existing = await this.findCollectionByHandle(col.handle)
        }
      }
      if (!existing) continue
      try {
        await this.addProductToCollection(productGid, existing.id)
      } catch {
        // Ignore duplicate collect or smart collection constraints.
      }
    }
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
    this.baseUrl = `https://${shop}/admin/api/2025-01`
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
    const snapshots: Array<{ sku: string; quantity: number; sourceName?: string; importPrice?: number | null; importPromoPrice?: number | null }> = []
    let cursor: string | null = null
    let hasNext = true

    while (hasNext) {
      const query = `
        query InventoryItems($cursor: String, $locationId: ID!) {
          inventoryItems(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              sku
              variant { price compareAtPrice product { title } }
              inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { quantity } }
            }
          }
        }
      `
      const gqlResponse: {
        inventoryItems: {
          pageInfo: { hasNextPage: boolean; endCursor: string }
          nodes: Array<{
            sku: string
            variant: { price: string | null; compareAtPrice: string | null; product: { title: string } } | null
            inventoryLevel: { quantities: Array<{ quantity: number }> } | null
          }>
        }
      } = await this.graphql(query, { cursor, locationId: this.locationId })

      for (const item of gqlResponse.inventoryItems.nodes) {
        if (item.sku) {
          const qty = item.inventoryLevel?.quantities[0]?.quantity ?? 0
          const rawPrice = item.variant?.price ? parseFloat(item.variant.price) : null
          const rawCompareAt = item.variant?.compareAtPrice ? parseFloat(item.variant.compareAtPrice) : null
          const hasPromo = rawCompareAt != null && rawCompareAt > 0
          snapshots.push({
            sku:              item.sku,
            quantity:         qty,
            sourceName:       item.variant?.product?.title ?? undefined,
            importPrice:      hasPromo ? rawCompareAt : rawPrice,
            importPromoPrice: hasPromo ? rawPrice : null,
          })
        }
      }

      hasNext = gqlResponse.inventoryItems.pageInfo.hasNextPage
      cursor = gqlResponse.inventoryItems.pageInfo.endCursor
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
