# API Contracts

> All endpoints accessible by the web UI and by external agents / applications

## API Overview

- **Base URL:** `https://syncdash.pages.dev/api`
- **Format:** JSON
- **Authentication:** `Authorization: Bearer <AGENT_BEARER_TOKEN>`
- **Versioning:** None (internal tool)

## Authentication

All `/api/*` routes require:
```
Authorization: Bearer <token>
```
Token defined in `AGENT_BEARER_TOKEN` environment variable.
The web UI, the AI agent (Claude), and any external application use the same token.
Web UI access is additionally gated by Cloudflare Access (SSO).

---

## Standard Response Format

### Success
```json
{ "data": { ... }, "meta": { "requestId": "req_abc123" } }
```

### List with pagination
```json
{
  "data": [ ... ],
  "meta": { "total": 300, "page": 1, "perPage": 50, "totalPages": 6 }
}
```

### Error
```json
{
  "error": { "code": "NOT_FOUND", "message": "Product SKU-001 not found" },
  "meta": { "requestId": "req_abc123" }
}
```

## Error Codes

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 403 | `FORBIDDEN` | Operation not allowed (e.g. write to read-only warehouse) |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | Resource already exists |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server / platform API error |

---

## Product Endpoints

### GET /api/products
List all products with sync status per platform and stock per warehouse.

**Query params:**
- `page` (default: 1), `perPage` (default: 50, max: 200)
- `status` — `active` | `archived`
- `search` — search by SKU or title
- `platform` — filter by presence on a platform
- `inconsistent` — `true` to show only products with cross-platform differences
- `collection` — filter by Shopify collection ID
- `category` — filter by WooCommerce category ID
- `warehouse` — filter by warehouse ID (products with qty > 0 in that warehouse)
- `onPromo` — `true` to show only products with a compare_at price set on at least one channel

**Response (200):**
```json
{
  "data": [
    {
      "id": "SKU-001",
      "title": "Acer Aspire 5",
      "status": "active",
      "supplier": { "id": "sup_acer", "name": "ACER" },
      "hasDescription": true,
      "isFeatured": false,
      "imageCount": 5,
      "hasMinImages": true,
      "localization": "ITA",
      "platforms": {
        "woocommerce":        { "status": "synced",  "price": 699.99, "compareAt": null },
        "shopify_komputerzz": { "status": "synced",  "price": 729.99, "compareAt": 799.99 },
        "shopify_tiktok":     { "status": "missing", "price": null,   "compareAt": null }
      },
      "stock": {
        "ireland":    12,
        "poland":     null,
        "acer_store": 40
      },
      "categories": ["woo_laptops"],
      "collections": ["col_laptops", "col_ita-qwerty"],
      "inconsistencies": 1,
      "updatedAt": "2026-02-20T10:00:00Z"
    }
  ],
  "meta": { "total": 300, "page": 1, "perPage": 50 }
}
```

---

### GET /api/products/:sku
Full product detail with field-level diff and all related data.

**Response (200):**
```json
{
  "data": {
    "id": "SKU-001",
    "title": "Acer Aspire 5",
    "description": "...",
    "status": "active",
    "taxCode": "8471.30",
    "vendor": "Acer",
    "productType": "Laptop",
    "isFeatured": false,
    "supplier": { "id": "sup_acer", "name": "ACER", "email": "orders@acer.com" },
    "variants": [
      { "id": "var_1", "sku": "SKU-001-ITA", "title": "ITA QWERTY", "price": 729.99, "stock": 8 }
    ],
    "images": [
      { "id": "img_1", "url": "https://...", "position": 0, "alt": "Acer Aspire 5" }
    ],
    "metafields": [
      { "namespace": "specifications", "key": "ram", "value": "16GB", "type": "single_line_text_field" }
    ],
    "prices": {
      "woocommerce":        { "price": 699.99, "compareAt": null },
      "shopify_komputerzz": { "price": 729.99, "compareAt": 799.99 },
      "shopify_tiktok":     { "price": 710.00, "compareAt": null }
    },
    "platforms": {
      "woocommerce":        { "status": "synced",      "recordType": "variant",  "platformId": "1042" },
      "shopify_komputerzz": { "status": "synced",      "recordType": "product",  "platformId": "gid://shopify/Product/123" },
      "shopify_tiktok":     { "status": "differences", "recordType": "product",  "platformId": "gid://shopify/Product/456" }
    },
    "stock": {
      "ireland":    { "quantity": 12, "quantityOrdered": 0, "purchasePrice": 520.00 },
      "poland":     { "quantity": null, "quantityOrdered": 0, "purchasePrice": null },
      "acer_store": { "quantity": 40,  "quantityOrdered": 20, "purchasePrice": 490.00 }
    },
    "categories": [
      { "id": "woo_laptops", "name": "Laptops", "platform": "woocommerce" }
    ],
    "collections": [
      { "id": "col_laptops",    "name": "Laptops",     "type": "product" },
      { "id": "col_ita-qwerty", "name": "ita-qwerty",  "type": "country_layout" }
    ],
    "localization": "ITA",
    "diff": {
      "title":       { "woocommerce": "ok", "shopify_komputerzz": "ok", "shopify_tiktok": "diff: 'Acer Aspire 5A'" },
      "description": { "woocommerce": "ok", "shopify_komputerzz": "ok", "shopify_tiktok": "ok" },
      "images":      { "woocommerce": "ok: 5/5", "shopify_komputerzz": "ok: 5/5", "shopify_tiktok": "diff: 3/5" }
    },
    "recentLogs": [
      { "action": "copy_images", "status": "success", "triggeredBy": "agent", "createdAt": "2026-02-19T14:00:00Z" }
    ]
  }
}
```

---

### POST /api/products
Create a product on selected platforms.

**Body:**
```json
{
  "sku": "SKU-NEW",
  "title": "Acer Swift 3",
  "description": "...",
  "vendor": "Acer",
  "productType": "Laptop",
  "taxCode": "8471.30",
  "isFeatured": false,
  "supplierId": "sup_acer",
  "variants": [
    { "title": "ITA QWERTY", "sku": "SKU-NEW-ITA", "price": 799.99, "stock": 10 }
  ],
  "images": [
    { "type": "url", "url": "https://...", "alt": "Acer Swift 3" }
  ],
  "prices": {
    "woocommerce": 779.99,
    "shopify_komputerzz": 799.99
  },
  "categoryIds": ["col_laptops", "col_ita-qwerty"],
  "platforms": ["woocommerce", "shopify_komputerzz"],
  "triggeredBy": "agent"
}
```

**Response (201):** `{ "data": { "sku": "SKU-NEW", "results": SyncResult[] } }`

---

### PATCH /api/products/:sku
Update product fields (title, description, status, categories, isFeatured).

**Body:**
```json
{
  "fields": { "title": "Acer Swift 3 Updated", "isFeatured": true },
  "platforms": ["woocommerce", "shopify_komputerzz"],
  "triggeredBy": "agent"
}
```

**Response (200):** `SyncResult[]`

---

### DELETE /api/products/:sku
Delete a product from selected platforms.

**Body:** `{ "platforms": ["shopify_tiktok"], "triggeredBy": "human" }`

**Response (200):** `SyncResult[]`

---

## Image Endpoints

### PUT /api/products/:sku/images — Replace all images
### POST /api/products/:sku/images — Add images
### DELETE /api/products/:sku/images — Delete all images

**Body (PUT/POST):**
```json
{
  "images": [
    { "type": "url", "url": "https://...", "alt": "Front view" }
  ],
  "platforms": ["woocommerce"],
  "triggeredBy": "human"
}
```

**Response (200):** `SyncResult[]`

---

### POST /api/products/:sku/images/copy

**Body:**
```json
{
  "sourcePlatform": "shopify_komputerzz",
  "targetPlatforms": ["woocommerce"],
  "mode": "replace",
  "triggeredBy": "agent"
}
```

**Response (200):** `SyncResult[]`

---

## Price Endpoints

### PATCH /api/products/:sku/prices

**Body:**
```json
{
  "prices": { "woocommerce": 699.99 },
  "compareAtPrices": { "woocommerce": 799.99 },
  "triggeredBy": "human"
}
```

**Response (200):** `SyncResult[]`

---

## Status Endpoint

### PATCH /api/products/:sku/status

**Body:**
```json
{
  "status": "archived",
  "platforms": ["shopify_tiktok"],
  "triggeredBy": "agent"
}
```

**Response (200):** `SyncResult[]`

---

## Category Endpoints

### PUT /api/products/:sku/categories

**Body:**
```json
{
  "categoryIds": ["col_laptops", "col_ita-qwerty"],
  "platforms": ["woocommerce", "shopify_komputerzz"],
  "triggeredBy": "human"
}
```

**Response (200):** `SyncResult[]`

---

## Import Endpoints

### POST /api/import/:platform
Import all products from a platform into D1.

**Params:** `platform` = `woocommerce` | `shopify_komputerzz` | `shopify_tiktok`

**Response (200):**
```json
{
  "data": {
    "imported": 284,
    "updated": 12,
    "skipped": 4,
    "errors": ["SKU-042: variant mapping failed"]
  }
}
```

---

## Analysis Endpoints

### GET /api/analyze
### GET /api/analyze/:sku

**Query params (GET /api/analyze):**
- `type` — filter by: `missing_images` | `different_title` | `different_description` | `missing_categories` | `different_price` | `missing_on_platform`

**Response (200):**
```json
{
  "data": [
    {
      "sku": "SKU-001",
      "type": "missing_images",
      "platforms": ["woocommerce"],
      "details": "WooCommerce has 0 images, shopify_komputerzz has 5",
      "suggestedFix": "Copy images from shopify_komputerzz to woocommerce"
    }
  ],
  "meta": { "total": 47 }
}
```

---

## Warehouse Endpoints

### GET /api/warehouses
List all warehouses with last sync status.

**Response (200):**
```json
{
  "data": [
    {
      "id": "ireland",
      "displayName": "Entrepôt Irlande",
      "address": "...",
      "sourceType": "shopify",
      "canModifyStock": false,
      "autoSync": true,
      "lastSynced": "2026-02-21T06:00:00Z",
      "totalProducts": 156,
      "totalStock": 892
    }
  ]
}
```

---

### GET /api/warehouses/:id
Warehouse detail with per-product stock.

**Query params:** `page`, `perPage`, `search` (SKU or name)

**Response (200):**
```json
{
  "data": {
    "id": "ireland",
    "displayName": "Entrepôt Irlande",
    "address": "Unit 5, Dublin Industrial Park, Dublin, Ireland",
    "lastSynced": "2026-02-21T06:00:00Z",
    "products": [
      {
        "sku": "SKU-001",
        "title": "Acer Aspire 5",
        "quantity": 12,
        "quantityOrdered": 20,
        "lastOrderDate": "2026-02-10T00:00:00Z",
        "purchasePrice": 520.00
      }
    ]
  },
  "meta": { "total": 156, "page": 1, "perPage": 50 }
}
```

---

### PATCH /api/warehouses/:id/stock
Manually override stock for a specific product (ACER Store only — returns 403 for read-only warehouses).

**Body:**
```json
{
  "productId": "SKU-001",
  "quantity": 38,
  "quantityOrdered": 20,
  "lastOrderDate": "2026-02-15T00:00:00Z",
  "purchasePrice": 490.00
}
```

**Response (200):** `{ "data": { "updated": true } }`

---

### POST /api/warehouses/:id/sync
Force a warehouse stock sync (manual trigger).

**Response (200):**
```json
{
  "data": {
    "warehouseId": "ireland",
    "productsUpdated": 156,
    "errors": [],
    "syncedAt": "2026-02-21T14:32:00Z"
  }
}
```

---

## Order Endpoints

### GET /api/orders
List purchase orders.

**Query params:** `page`, `perPage`, `supplierId`, `warehouseId`, `paid` (true/false), `arrivalStatus`

**Response (200):**
```json
{
  "data": [
    {
      "id": "ord_001",
      "invoiceNumber": "INV-2026-042",
      "supplier": { "id": "sup_acer", "name": "ACER" },
      "warehouse": { "id": "ireland", "displayName": "Entrepôt Irlande" },
      "orderDate": "2026-02-10T00:00:00Z",
      "paid": true,
      "sentToSupplier": true,
      "arrivalStatus": "partial",
      "itemCount": 5,
      "totalUnits": 100
    }
  ]
}
```

---

### GET /api/orders/:id
Order detail with line items.

**Response (200):**
```json
{
  "data": {
    "id": "ord_001",
    "invoiceNumber": "INV-2026-042",
    "supplier": { "id": "sup_acer", "name": "ACER", "email": "orders@acer.com" },
    "warehouse": { "id": "ireland", "displayName": "Entrepôt Irlande" },
    "orderDate": "2026-02-10T00:00:00Z",
    "paid": true,
    "sentToSupplier": true,
    "arrivalStatus": "partial",
    "items": [
      {
        "product": { "id": "SKU-001", "title": "Acer Aspire 5" },
        "quantity": 20,
        "quantityReceived": 15,
        "purchasePrice": 520.00
      }
    ]
  }
}
```

---

### POST /api/orders
Create a new purchase order.

**Body:**
```json
{
  "invoiceNumber": "INV-2026-043",
  "supplierId": "sup_acer",
  "warehouseId": "ireland",
  "orderDate": "2026-02-21T00:00:00Z",
  "paid": false,
  "sentToSupplier": false,
  "items": [
    { "productId": "SKU-001", "quantity": 30, "purchasePrice": 520.00 }
  ]
}
```

**Response (201):** Order object

---

### PATCH /api/orders/:id
Update order metadata (paid, sentToSupplier, arrivalStatus, quantityReceived per item).

---

## Supplier Endpoints

### GET /api/suppliers
### GET /api/suppliers/:id
### POST /api/suppliers
### PATCH /api/suppliers/:id

**Supplier object:**
```json
{
  "id": "sup_acer",
  "name": "ACER",
  "contactFirstName": "Jean",
  "contactLastName": "Dupont",
  "email": "orders@acer.com"
}
```

---

## Health Check Endpoint

### GET /api/health
Return the most recent API health check results.

**Response (200):**
```json
{
  "data": {
    "checkedAt": "2026-02-21T06:00:00Z",
    "durationSeconds": 18.4,
    "results": {
      "woocommerce":        { "ok": true,  "latency_ms": 340, "error": null },
      "shopify_komputerzz": { "ok": true,  "latency_ms": 210, "error": null },
      "shopify_tiktok":     { "ok": false, "latency_ms": null, "error": "401 Unauthorized" },
      "ireland":            { "ok": true,  "latency_ms": 180, "error": null },
      "acer_store":         { "ok": true,  "latency_ms": 4200, "error": null }
    }
  }
}
```

---

### POST /api/health
Force a new health check immediately.

**Response (200):** Same as GET /api/health after running the check.

---

## Sync Log Endpoint

### GET /api/sync/logs

**Query params:** `page`, `perPage`, `platform`, `action`, `status`, `triggeredBy`, `productId`

**Response (200):**
```json
{
  "data": [
    {
      "id": "abc123",
      "productId": "SKU-001",
      "platform": "woocommerce",
      "action": "copy_images",
      "status": "success",
      "message": "3 images copied from shopify_komputerzz",
      "triggeredBy": "agent",
      "createdAt": "2026-02-21T14:32:00Z"
    }
  ]
}
```

---

## Category Mapping Endpoints

### GET /api/mappings
### PUT /api/mappings

**GET response:**
```json
{
  "data": [
    {
      "shopifyCollection": { "id": "col_laptops", "name": "Laptops" },
      "wooCategories": [{ "id": "woo_laptops", "name": "Laptops" }]
    }
  ],
  "meta": { "total": 12, "mapped": 10, "unmapped": 2 }
}
```

**PUT body:**
```json
{
  "mappings": [
    { "shopifyCollectionId": "col_laptops", "wooCategoryIds": ["woo_laptops"] }
  ]
}
```

---

## Validation Endpoint

### GET /api/validate/woocommerce-readiness

**Response (200):**
```json
{
  "data": {
    "ready": false,
    "blockers": [
      {
        "type": "no_product_collection",
        "sku": "SKU-042",
        "title": "Acer Predator",
        "message": "No 'product' type collection assigned"
      },
      {
        "type": "no_woo_mapping",
        "shopifyCollectionId": "col_gpu",
        "shopifyCollectionName": "GPU",
        "message": "No WooCommerce category mapped"
      }
    ],
    "productsBlocked": 5,
    "collectionsUnmapped": 1,
    "productsReady": 295
  }
}
```

---

## TikTok Selection Endpoints

### GET /api/tiktok/selection
### POST /api/tiktok/selection/:sku — Add to TikTok selection
### DELETE /api/tiktok/selection/:sku — Remove from TikTok selection

---

## Shared Types

```typescript
type Platform =
  | 'woocommerce'
  | 'shopify_komputerzz'
  | 'shopify_tiktok'
  | 'platform_4'
  | 'platform_5'

type WarehouseId = 'ireland' | 'poland' | 'acer_store' | 'spain'

type SyncResult = {
  platform: Platform
  success: boolean
  platformId?: string
  error?: string
}

type ImageInput =
  | { type: 'url';  url: string; alt?: string }
  | { type: 'file'; data: Buffer; filename: string; mimeType: string }

type TriggeredBy = 'human' | 'agent' | 'system'

type InconsistencyType =
  | 'missing_images'
  | 'different_title'
  | 'different_description'
  | 'missing_categories'
  | 'different_price'
  | 'missing_on_platform'

type ArrivalStatus = 'pending' | 'arrived' | 'partial' | 'cancelled'
```
