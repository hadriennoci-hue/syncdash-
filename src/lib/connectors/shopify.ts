import { shopifyLimiter } from '@/lib/utils/rate-limiter'
import type {
  PlatformConnector, RawProduct, RawVariant, RawImage, RawCollection,
  RawMetafield, ProductPayload, HealthCheckResult, WarehouseStockOptions, PriceSnapshot,
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
    const RETRYABLE = new Set([502, 503, 504])
    const DELAYS_MS = [2000, 5000]
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, DELAYS_MS[attempt - 1]))
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
      if (!res.ok) {
        const body = await res.text()
        lastError = new Error(`Shopify GraphQL error: ${res.status} ${body}`)
        if (RETRYABLE.has(res.status) && attempt < DELAYS_MS.length) continue
        throw lastError
      }
      const json = await res.json() as { data?: T; errors?: unknown[] }
      if (json.errors?.length) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`)
      return json.data as T
    }
    throw lastError!
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

  /**
   * Wizhard semantics:
   * - price     = current selling price
   * - compareAt = crossed-out old price
   *
   * Shopify semantics:
   * - price          = current selling price
   * - compareAtPrice = crossed-out old price, only when compareAtPrice > price
   */
  private toShopifySalePricing(price: number | null, compareAt?: number | null): {
    price: string | null
    compareAtPrice: string | null
  } {
    const currentPrice = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
    const oldPrice = typeof compareAt === 'number' && Number.isFinite(compareAt) && compareAt > 0 ? compareAt : null

    if (currentPrice == null) return { price: null, compareAtPrice: null }
    if (oldPrice != null && oldPrice > currentPrice) {
      return { price: currentPrice.toString(), compareAtPrice: oldPrice.toString() }
    }
    return { price: currentPrice.toString(), compareAtPrice: null }
  }

  private fromShopifySalePricing(price: string | number | null, compareAtPrice: string | number | null): {
    price: number | null
    compareAt: number | null
  } {
    const currentPrice =
      typeof price === 'number' ? price :
      price ? parseFloat(price) : null
    const oldPrice =
      typeof compareAtPrice === 'number' ? compareAtPrice :
      compareAtPrice ? parseFloat(compareAtPrice) : null

    if (currentPrice == null || !Number.isFinite(currentPrice)) {
      return { price: null, compareAt: null }
    }
    if (oldPrice != null && Number.isFinite(oldPrice) && oldPrice > currentPrice) {
      return { price: currentPrice, compareAt: oldPrice }
    }
    return { price: currentPrice, compareAt: null }
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

  async fetchPriceSnapshot(): Promise<Map<string, PriceSnapshot>> {
    const map = new Map<string, PriceSnapshot>()
    let cursor: string | null = null
    while (true) {
      const afterArg: string = cursor ? `, after: "${cursor}"` : ''
      const gql: string = `{
        products(first: 50${afterArg}) {
          edges {
            node {
              variants(first: 50) {
                edges {
                  node { sku price compareAtPrice }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`
      type SnapshotGqlResult = {
        products: {
          edges: Array<{ node: { variants: { edges: Array<{ node: { sku: string | null; price: string | null; compareAtPrice: string | null } }> } } }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      }
      const data: SnapshotGqlResult = await this.graphql<{
        products: {
          edges: Array<{
            node: {
              variants: {
                edges: Array<{
                  node: { sku: string | null; price: string | null; compareAtPrice: string | null }
                }>
              }
            }
          }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      }>(gql)
      for (const { node: product } of data.products.edges) {
        for (const { node: variant } of product.variants.edges) {
          if (!variant.sku) continue
          const normalizedPricing = this.fromShopifySalePricing(
            variant.price ?? null,
            variant.compareAtPrice ?? null,
          )
          // Normalize Shopify sale pricing into Wizhard semantics:
          // current price in `price`, crossed-out old price in `compareAt`.
          map.set(variant.sku, {
            price: normalizedPricing.price,
            compareAt: normalizedPricing.compareAt,
          })
        }
      }
      if (!data.products.pageInfo.hasNextPage) break
      cursor = data.products.pageInfo.endCursor
    }
    return map
  }

  private normalizeProduct(node: Record<string, unknown>): RawProduct | null {
    try {
      const variants = (node.variants as { nodes: unknown[] }).nodes.map(
        (v): RawVariant => {
          const vn = v as Record<string, unknown>
          const opts = (vn.selectedOptions as Array<{ name: string; value: string }>) ?? []
          const normalizedPricing = this.fromShopifySalePricing(
            typeof vn.price === 'string' ? vn.price : null,
            typeof vn.compareAtPrice === 'string' ? vn.compareAtPrice : null,
          )
          return {
            platformId:   String(vn.id),
            title:        (vn.title as string) ?? null,
            sku:          (vn.sku as string) ?? null,
            price:        normalizedPricing.price,
            compareAtPrice: normalizedPricing.compareAt,
            stock:        (vn.inventoryQuantity as number) ?? 0,
            position:     (vn.position as number) ?? 0,
            optionName1:  opts[0]?.name ?? null,
            option1:      opts[0]?.value ?? null,
            optionName2:  opts[1]?.name ?? null,
            option2:      opts[1]?.value ?? null,
            optionName3:  opts[2]?.name ?? null,
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

      const firstVariantPricing = this.fromShopifySalePricing(
        firstVariant?.price ?? null,
        firstVariant?.compareAtPrice ?? null,
      )
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
          price:     firstVariantPricing.price,
          compareAt: firstVariantPricing.compareAt,
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

  private async findVariantBySku(
    platformId: string,
    sku: string
  ): Promise<{ id: string; inventoryItemId: string | null } | null> {
    const query = `
      query VariantBySku($q: String!) {
        productVariants(first: 10, query: $q) {
          nodes {
            id
            inventoryItem { id }
            product { id }
          }
        }
      }
    `
    const data = await this.graphql<{
      productVariants: {
        nodes: Array<{
          id: string
          inventoryItem?: { id?: string | null } | null
          product?: { id?: string | null } | null
        }>
      }
    }>(query, { q: `sku:"${sku}"` })

    const match = data.productVariants.nodes.find((node) => node.product?.id === platformId)
    if (!match?.id) return null

    return {
      id: match.id,
      inventoryItemId: match.inventoryItem?.id ?? null,
    }
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

  // -------------------------------------------------------------------------
  // Online Store publication
  // -------------------------------------------------------------------------

  // Publish a product to the Online Store channel via REST.
  // GraphQL publishablePublish requires read_publications scope which custom
  // app tokens may not have. REST PUT with published:true only needs write_products.
  private async publishToOnlineStore(productGid: string): Promise<void> {
    const numericId = this.gidToNumericId(productGid)
    await this.rest('PUT', `/products/${numericId}.json`, {
      product: { id: numericId, published: true },
    })
  }

  private async createVariableProductViaGraphQL(data: ProductPayload): Promise<string> {
    // Build option dimensions from variant payloads
    const optionBuckets = new Map<string, Set<string>>()
    for (const v of data.variants!) {
      const pairs = [
        { name: (v.optionName1 ?? '').trim() || 'Option 1', value: v.option1?.trim() || null },
        { name: (v.optionName2 ?? '').trim() || 'Option 2', value: v.option2?.trim() || null },
        { name: (v.optionName3 ?? '').trim() || 'Option 3', value: v.option3?.trim() || null },
      ]
      for (const pair of pairs) {
        if (!pair.value) continue
        const set = optionBuckets.get(pair.name) ?? new Set<string>()
        set.add(pair.value)
        optionBuckets.set(pair.name, set)
      }
    }
    const productOptions = Array.from(optionBuckets.entries())
      .filter(([, values]) => values.size > 0)
      .map(([name, values]) => ({ name, values: Array.from(values).map((v) => ({ name: v })) }))

    // Step 1: create product with option dimensions
    const createMutation = `
      mutation ProductCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product { id options { id name values } }
          userErrors { field message }
        }
      }
    `
    const productInput: Record<string, unknown> = {
      title:           data.title,
      descriptionHtml: data.description ?? '',
      status:          data.status.toUpperCase(),
      category:        data.shopifyCategory ?? SHOPIFY_ELECTRONICS_CATEGORY_GID,
      productOptions,
    }
    if (data.vendor)      productInput.vendor = data.vendor
    if (data.productType) productInput.productType = data.productType

    const createResult = await this.graphql<{
      productCreate: {
        product: {
          id: string
          options: Array<{ id: string; name: string; values: string[] }>
        } | null
        userErrors: Array<{ message: string }>
      }
    }>(createMutation, { product: productInput })

    if (createResult.productCreate.userErrors.length > 0) {
      throw new Error(createResult.productCreate.userErrors.map((e) => e.message).join(', '))
    }

    const productId = createResult.productCreate.product!.id

    // Step 2: create all variants, removing the auto-generated standalone default variant
    const variantInputs = data.variants!.map((v) => {
      const optionValues: Array<{ optionName: string; name: string }> = []
      if (v.option1?.trim() && v.optionName1?.trim()) optionValues.push({ optionName: v.optionName1.trim(), name: v.option1.trim() })
      if (v.option2?.trim() && v.optionName2?.trim()) optionValues.push({ optionName: v.optionName2.trim(), name: v.option2.trim() })
      if (v.option3?.trim() && v.optionName3?.trim()) optionValues.push({ optionName: v.optionName3.trim(), name: v.option3.trim() })

      const inventoryItem: Record<string, unknown> = { tracked: true }
      if (v.sku) inventoryItem.sku = v.sku
      const pricing = this.toShopifySalePricing(v.price ?? null, v.compareAt ?? null)
      const input: Record<string, unknown> = {
        optionValues,
        inventoryItem,
      }
      if (pricing.price != null) input.price = pricing.price
      if (pricing.compareAtPrice != null) input.compareAtPrice = pricing.compareAtPrice
      return input
    })

    const bulkMutation = `
      mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          productVariants { id sku }
          userErrors { field message }
        }
      }
    `
    const bulkResult = await this.graphql<{
      productVariantsBulkCreate: {
        productVariants: Array<{ id: string; sku: string }>
        userErrors: Array<{ message: string }>
      }
    }>(bulkMutation, { productId, variants: variantInputs, strategy: 'REMOVE_STANDALONE_VARIANT' })

    if (bulkResult.productVariantsBulkCreate.userErrors.length > 0) {
      throw new Error(bulkResult.productVariantsBulkCreate.userErrors.map((e) => e.message).join(', '))
    }

    await this.publishToOnlineStore(productId)
    return productId
  }

  async createProduct(data: ProductPayload): Promise<string> {
    if ((data.variants?.length ?? 0) > 1) {
      return this.createVariableProductViaGraphQL(data)
    }

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
      const pricing = this.toShopifySalePricing(data.price ?? null, data.compareAt ?? null)
      if (pricing.price != null) variantInput.price = pricing.price
      variantInput.compareAtPrice = pricing.compareAtPrice

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

    await this.publishToOnlineStore(productId)
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

    await this.publishToOnlineStore(platformId)
  }

  async updateProductForSku(platformId: string, _sku: string, data: Partial<ProductPayload>): Promise<void> {
    await this.updateProduct(platformId, data)
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
    const pricing = this.toShopifySalePricing(price, compareAt ?? null)
    await this.rest('PUT', `/variants/${numericId}.json`, {
      variant: {
        id: numericId,
        price: pricing.price,
        compare_at_price: pricing.compareAtPrice,
      },
    })
  }

  async updatePriceForSku(platformId: string, sku: string, price: number | null, compareAt?: number | null): Promise<void> {
    const variant = await this.findVariantBySku(platformId, sku)
    if (!variant) {
      await this.updatePrice(platformId, price, compareAt)
      return
    }

    const numericId = this.gidToNumericId(variant.id)
    const pricing = this.toShopifySalePricing(price, compareAt ?? null)
    await this.rest('PUT', `/variants/${numericId}.json`, {
      variant: {
        id: numericId,
        price: pricing.price,
        compare_at_price: pricing.compareAtPrice,
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

  async updateStockForSku(platformId: string, sku: string, quantity: number): Promise<void> {
    let locationGid = this.locationId
    if (!locationGid) {
      const locData = await this.graphql<{ locations: { nodes: Array<{ id: string }> } }>(
        `{ locations(first: 1) { nodes { id } } }`
      )
      locationGid = locData.locations.nodes[0]?.id
      if (!locationGid) throw new Error('No Shopify location found for inventory update')
    }

    const variant = await this.findVariantBySku(platformId, sku)
    if (!variant?.inventoryItemId) {
      await this.updateStock(platformId, quantity)
      return
    }

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
        setQuantities: [{ inventoryItemId: variant.inventoryItemId, locationId: locationGid, quantity }],
      },
    })
    if (result.inventorySetOnHandQuantities.userErrors.length > 0) {
      throw new Error(result.inventorySetOnHandQuantities.userErrors.map((e) => e.message).join(', '))
    }
  }

  private async resolveInventoryLocation(): Promise<string> {
    if (this.locationId) return this.locationId

    const locData = await this.graphql<{ locations: { nodes: Array<{ id: string }> } }>(
      `{ locations(first: 1) { nodes { id } } }`
    )
    const locationGid = locData.locations.nodes[0]?.id
    if (!locationGid) throw new Error('No Shopify location found')
    return locationGid
  }

  private async setOnHandQuantities(
    setQuantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }>
  ): Promise<void> {
    if (setQuantities.length === 0) return

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
        inventorySetOnHandQuantities: { userErrors: Array<{ field?: string[] | null; message: string }> }
      }>(mutation, { input: { reason: 'correction', setQuantities: batch } })
      if (result.inventorySetOnHandQuantities.userErrors.length > 0) {
        throw new Error(result.inventorySetOnHandQuantities.userErrors
          .map((e) => e.field?.length ? `${e.field.join('.')}: ${e.message}` : e.message)
          .join(', '))
      }
    }
  }

  // Bulk-set stock: resolve all inventory items in one nodes() query per 50 products,
  // then set quantities in one inventorySetOnHandQuantities mutation per 250 items.
  // This replaces 3N individual API calls with ~ceil(N/50) + ceil(N/250) calls.
  async bulkSetStock(items: Array<{ platformId: string; quantity: number }>): Promise<void> {
    if (items.length === 0) return

    const locationGid = await this.resolveInventoryLocation()

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

    await this.setOnHandQuantities(setQuantities)
  }

  async bulkSetStockForSkus(items: Array<{ platformId: string; sku: string; quantity: number }>): Promise<void> {
    if (items.length === 0) return

    const locationGid = await this.resolveInventoryLocation()
    const QUERY_BATCH = 50
    const setQuantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = []
    const pending = new Map<string, Array<{ sku: string; quantity: number }>>()

    for (const item of items) {
      const productItems = pending.get(item.platformId) ?? []
      productItems.push({ sku: item.sku, quantity: item.quantity })
      pending.set(item.platformId, productItems)
    }

    const productIds = [...pending.keys()]
    for (let i = 0; i < productIds.length; i += QUERY_BATCH) {
      const ids = productIds.slice(i, i + QUERY_BATCH)
      const query = `
        query InventoryItemsBySku($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              variants(first: 250) {
                nodes {
                  sku
                  inventoryItem { id }
                }
              }
            }
          }
        }
      `
      const data = await this.graphql<{
        nodes: Array<{
          id?: string
          variants?: { nodes: Array<{ sku?: string | null; inventoryItem?: { id?: string | null } | null }> }
        } | null>
      }>(query, { ids })

      for (const node of data.nodes) {
        if (!node?.id || !node.variants) continue
        const productItems = pending.get(node.id) ?? []
        const variants = node.variants.nodes
        for (const item of productItems) {
          const matchingVariant = variants.find((variant) => variant.sku === item.sku)
          const fallbackVariant = variants.length === 1 ? variants[0] : null
          const inventoryItemId = (matchingVariant ?? fallbackVariant)?.inventoryItem?.id
          if (!inventoryItemId) {
            throw new Error(`No Shopify inventory item found for SKU ${item.sku} on product ${node.id}`)
          }
          setQuantities.push({ inventoryItemId, locationId: locationGid, quantity: item.quantity })
        }
      }
    }

    const seenInventoryItems = new Set<string>()
    const dedupedSetQuantities = setQuantities.filter((item) => {
      const key = `${item.locationId}:${item.inventoryItemId}`
      if (seenInventoryItems.has(key)) return false
      seenInventoryItems.add(key)
      return true
    })

    if (dedupedSetQuantities.length !== items.length) {
      throw new Error(`Resolved ${dedupedSetQuantities.length} unique Shopify inventory items for ${items.length} stock updates`)
    }

    await this.setOnHandQuantities(dedupedSetQuantities)
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

  async toggleStatusForSku(platformId: string, _sku: string, status: 'active' | 'archived'): Promise<void> {
    await this.toggleStatus(platformId, status)
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

  private parsePipeSeparatedValues(raw: string | null | undefined): string[] {
    if (!raw) return []
    return raw
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
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

  /** List all products on the store — returns GID and first variant SKU. */
  async listAllProducts(): Promise<Array<{ gid: string; sku: string }>> {
    type ProductsPage = {
      products: {
        nodes: Array<{ id: string; variants: { nodes: Array<{ sku: string }> } }>
        pageInfo: { hasNextPage: boolean; endCursor: string }
      }
    }
    const productsQuery = `
      query Products($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          nodes { id variants(first: 1) { nodes { sku } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `
    const results: Array<{ gid: string; sku: string }> = []
    let cursor: string | null = null
    do {
      const data: ProductsPage = await this.graphql<ProductsPage>(productsQuery, { first: 50, after: cursor })
      for (const p of data.products.nodes) {
        results.push({ gid: p.id, sku: p.variants.nodes[0]?.sku ?? '' })
      }
      cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
    } while (cursor)
    return results
  }

  /** List all custom collections (not smart). Returns numeric id, handle, title. */
  async listCustomCollections(): Promise<Array<{ id: number; handle: string; title: string }>> {
    const res = await this.rest<{ custom_collections: Array<{ id: number; handle: string; title: string }> }>(
      'GET', '/custom_collections.json?limit=250'
    )
    return res.custom_collections
  }

  /** Delete a custom collection by its numeric Shopify ID. */
  async deleteCustomCollection(numericId: number): Promise<void> {
    await shopifyLimiter.throttle()
    const res = await fetch(`${this.baseUrl}/custom_collections/${numericId}.json`, {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': this.token, 'User-Agent': 'Wizhard/1.0' },
      // @ts-ignore
      cf: { cacheEverything: false },
    })
    if (!res.ok && res.status !== 404) throw new Error(`Shopify DELETE collection error: ${res.status} ${await res.text()}`)
  }

  /** List all collects (product↔collection links) for a product (numeric ID). */
  async listCollectsForProduct(productNumericId: number): Promise<Array<{ id: number; collection_id: number }>> {
    const res = await this.rest<{ collects: Array<{ id: number; collection_id: number; product_id: number }> }>(
      'GET', `/collects.json?product_id=${productNumericId}&limit=250`
    )
    return res.collects
  }

  /** Delete a collect (product↔collection link) by its ID. */
  async deleteCollect(collectId: number): Promise<void> {
    await shopifyLimiter.throttle()
    const res = await fetch(`${this.baseUrl}/collects/${collectId}.json`, {
      method: 'DELETE',
      headers: { 'X-Shopify-Access-Token': this.token, 'User-Agent': 'Wizhard/1.0' },
      // @ts-ignore
      cf: { cacheEverything: false },
    })
    if (!res.ok && res.status !== 404) throw new Error(`Shopify DELETE collect error: ${res.status} ${await res.text()}`)
  }

  async syncCollectionAttributeValues(
    collectionHandle: string,
    attributes: Record<string, string[]>
  ): Promise<void> {
    const collection = await this.findCollectionByHandle(collectionHandle)
    if (!collection) return

    const query = `
      query CollectionMetafields($id: ID!) {
        collection(id: $id) {
          id
          metafields(first: 250) { nodes { namespace key value } }
        }
      }
    `
    const data = await this.graphql<{
      collection: {
        id: string
        metafields: { nodes: Array<{ namespace: string; key: string; value: string | null }> }
      } | null
    }>(query, { id: collection.id })
    if (!data.collection) return

    const existing = new Map<string, string>()
    for (const mf of data.collection.metafields.nodes) {
      if (mf.namespace !== 'custom') continue
      existing.set(mf.key.trim().toLowerCase(), mf.value ?? '')
    }

    const toWrite: Array<{
      ownerId: string
      namespace: string
      key: string
      type: string
      value: string
    }> = []

    for (const [rawKey, rawValues] of Object.entries(attributes)) {
      const key = rawKey.trim().toLowerCase()
      if (!key) continue
      const incoming = Array.from(new Set(
        rawValues.map((v) => v.trim()).filter((v) => v.length > 0)
      ))
      if (incoming.length === 0) continue

      const current = this.parsePipeSeparatedValues(existing.get(key))
      const merged = Array.from(new Set([...current, ...incoming]))
      const nextValue = merged.join(' | ')
      if (nextValue === (existing.get(key) ?? '')) continue

      toWrite.push({
        ownerId: collection.id,
        namespace: 'custom',
        key,
        type: 'single_line_text_field',
        value: nextValue,
      })
    }

    if (toWrite.length === 0) return

    const mutation = `
      mutation SetCollectionMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }
    `

    const batchSize = 25
    for (let i = 0; i < toWrite.length; i += batchSize) {
      const batch = toWrite.slice(i, i + batchSize)
      const result = await this.graphql<{
        metafieldsSet: { userErrors: Array<{ message: string }> }
      }>(mutation, { metafields: batch })
      if (result.metafieldsSet.userErrors.length > 0) {
        throw new Error(result.metafieldsSet.userErrors.map((e) => e.message).join(', '))
      }
    }
  }

  async syncProductAttributeMetafields(
    productGid: string,
    attributes: Record<string, string[]>
  ): Promise<void> {
    const toWrite = Object.entries(attributes)
      .map(([key, values]) => ({
        ownerId: productGid,
        namespace: 'custom',
        key: key.trim().toLowerCase(),
        type: 'single_line_text_field',
        value: Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))).join(' | '),
      }))
      .filter((m) => m.key.length > 0 && m.value.length > 0)

    if (toWrite.length === 0) return

    // Write one-by-one so a constrained/invalid key does not block all other attributes.
    const mutation = `
      mutation SetProductMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }
    `

    for (const metafield of toWrite) {
      const result = await this.graphql<{
        metafieldsSet: { userErrors: Array<{ message: string }> }
      }>(mutation, { metafields: [metafield] })
      if (result.metafieldsSet.userErrors.length > 0) {
        // Keep push resilient: skip keys rejected by store metafield constraints.
        continue
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

  private fromShopifySalePricing(price: string | number | null, compareAtPrice: string | number | null): {
    price: number | null
    compareAt: number | null
  } {
    const currentPrice =
      typeof price === 'number' ? price :
      price ? parseFloat(price) : null
    const oldPrice =
      typeof compareAtPrice === 'number' ? compareAtPrice :
      compareAtPrice ? parseFloat(compareAtPrice) : null

    if (currentPrice == null || !Number.isFinite(currentPrice)) {
      return { price: null, compareAt: null }
    }
    if (oldPrice != null && Number.isFinite(oldPrice) && oldPrice > currentPrice) {
      return { price: currentPrice, compareAt: oldPrice }
    }
    return { price: currentPrice, compareAt: null }
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

  async getStock(options: WarehouseStockOptions = {}) {
    const onProgress = options.onProgress
    const snapshots: Array<{ sku: string; quantity: number; sourceName?: string; importPrice?: number | null; importPromoPrice?: number | null }> = []
    let cursor: string | null = null
    let hasNext = true

    onProgress?.({
      stage: 'start',
      warehouseId: 'ireland',
      message: 'Scanning Ireland warehouse',
      current: 0,
      total: 1,
    })

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
          const pricing = this.fromShopifySalePricing(
            item.variant?.price ?? null,
            item.variant?.compareAtPrice ?? null,
          )
          snapshots.push({
            sku:              item.sku,
            quantity:         qty,
            sourceName:       item.variant?.product?.title ?? undefined,
            importPrice:      pricing.compareAt ?? pricing.price,
            importPromoPrice: pricing.compareAt != null ? pricing.price : null,
          })
        }
      }

      hasNext = gqlResponse.inventoryItems.pageInfo.hasNextPage
      cursor = gqlResponse.inventoryItems.pageInfo.endCursor
    }

    onProgress?.({
      stage: 'fetch_done',
      warehouseId: 'ireland',
      message: 'Ireland scan done',
      current: 1,
      total: 1,
    })

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
