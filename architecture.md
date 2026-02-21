# Architecture

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE PAGES (SyncDash)                   │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐  │
│  │/products │ │/channels │ │/warehouse│ │ /orders  │ │/sync  │  │
│  │          │ │          │ │    s     │ │/suppliers│ │/logs  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │               REST API  (/api/*)                           │  │
│  │   Auth: Cloudflare Access + Bearer token                   │  │
│  │   Accessible: Web UI + external AI agents + apps          │  │
│  └───────────────────────────┬────────────────────────────────┘  │
│                              │                                    │
│                  ┌───────────┴──────────┐                        │
│                  │   Cloudflare D1      │  ← Master data         │
│                  │   (SQLite / Drizzle) │                        │
│                  └───────────┬──────────┘                        │
│                              │                                    │
│  ┌───────────────────────────┴──────────────────────────────┐    │
│  │           Cloudflare Cron Triggers (daily)               │    │
│  │   • Sync warehouses                                      │    │
│  │   • Push stock to channels                               │    │
│  │   • Reconcile orders                                     │    │
│  │   • API health check                                     │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ PlatformConnector + WarehouseConnector
         ┌──────────────────┼───────────────────────────────────────┐
         ▼                  ▼                  ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ WooCommerce  │  │ Shopify #1   │  │   Shopify #2     │  │  ACER Store  │
│ coincart     │  │ komputerzz   │  │   TikTok Shop    │  │  (scraping)  │
│ REST API     │  │ GraphQL API  │  │   GraphQL API    │  │              │
└──────────────┘  └──────────────┘  └──────────────────┘  └──────────────┘
                                           │
                                     ┌─────┘
                                     │  Stock Ireland (auto-updated by warehouse)
                                     ▼
                              ┌──────────────┐
                              │ Entrepôt IE  │  Stock Pologne (API TBD)
                              └──────────────┘

         ▲ (future: platform_4, platform_5)
         │ Appels REST depuis l'extérieur
  ┌─────────────┐
  │  Claude     │  ← External AI agent
  │  (agent)    │
  └─────────────┘
```

---

## Directory Structure

```
/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (dashboard)/              # Cloudflare Access protected pages
│   │   │   ├── page.tsx              # / — Dashboard (health, sync status, logs)
│   │   │   ├── products/
│   │   │   │   ├── page.tsx          # /products — product table + filters
│   │   │   │   ├── new/page.tsx      # /products/new — create form
│   │   │   │   └── [sku]/
│   │   │   │       ├── page.tsx      # /products/[sku] — full detail, no scroll
│   │   │   │       └── edit/page.tsx # /products/[sku]/edit
│   │   │   ├── channels/
│   │   │   │   ├── page.tsx          # /channels — sales channels list
│   │   │   │   └── [id]/page.tsx     # /channels/[id] — in stock / disabled / oos
│   │   │   ├── warehouses/
│   │   │   │   ├── page.tsx          # /warehouses — warehouses list
│   │   │   │   └── [id]/page.tsx     # /warehouses/[id] — detail + force sync
│   │   │   ├── orders/
│   │   │   │   ├── page.tsx          # /orders — purchase orders list
│   │   │   │   ├── new/page.tsx      # /orders/new — create order
│   │   │   │   └── [id]/page.tsx     # /orders/[id] — order detail
│   │   │   ├── suppliers/
│   │   │   │   ├── page.tsx          # /suppliers — suppliers list
│   │   │   │   └── [id]/page.tsx     # /suppliers/[id] — detail + products + orders
│   │   │   ├── analyze/page.tsx      # /analyze — inconsistency report
│   │   │   ├── mappings/page.tsx     # /mappings — Shopify ↔ WooCommerce mapping
│   │   │   ├── validate/page.tsx     # /validate — WooCommerce readiness
│   │   │   ├── sync/
│   │   │   │   ├── page.tsx          # /sync — bulk push actions
│   │   │   │   └── logs/page.tsx     # /sync/logs — full operation history
│   │   │   ├── tiktok/page.tsx       # /tiktok — TikTok selection (30-40 products)
│   │   │   └── settings/
│   │   │       ├── page.tsx          # /settings — API keys, config
│   │   │       └── import/page.tsx   # /settings/import — import from platforms
│   │   │
│   │   └── api/                      # REST API routes (Bearer token auth)
│   │       ├── products/
│   │       │   ├── route.ts          # GET /api/products, POST /api/products
│   │       │   └── [sku]/
│   │       │       ├── route.ts      # GET/PATCH/DELETE /api/products/:sku
│   │       │       ├── images/
│   │       │       │   ├── route.ts  # PUT/POST/DELETE /api/products/:sku/images
│   │       │       │   └── copy/route.ts
│   │       │       ├── prices/route.ts
│   │       │       ├── categories/route.ts
│   │       │       └── status/route.ts
│   │       ├── import/[platform]/route.ts
│   │       ├── analyze/
│   │       │   ├── route.ts
│   │       │   └── [sku]/route.ts
│   │       ├── channels/
│   │       │   └── [id]/route.ts     # GET /api/channels/:id/products
│   │       ├── warehouses/
│   │       │   ├── route.ts          # GET /api/warehouses
│   │       │   └── [id]/
│   │       │       ├── route.ts      # GET /api/warehouses/:id
│   │       │       ├── stock/route.ts # PATCH /api/warehouses/:id/stock
│   │       │       └── sync/route.ts  # POST /api/warehouses/:id/sync (force)
│   │       ├── orders/
│   │       │   ├── route.ts          # GET/POST /api/orders
│   │       │   └── [id]/route.ts     # GET/PATCH /api/orders/:id
│   │       ├── suppliers/
│   │       │   ├── route.ts          # GET/POST /api/suppliers
│   │       │   └── [id]/route.ts     # GET/PATCH /api/suppliers/:id
│   │       ├── sync/
│   │       │   ├── logs/route.ts     # GET /api/sync/logs
│   │       │   └── daily/route.ts    # POST /api/sync/daily (cron trigger)
│   │       ├── health/route.ts       # GET /api/health (last check), POST (force check)
│   │       ├── mappings/route.ts
│   │       ├── validate/woocommerce-readiness/route.ts
│   │       └── tiktok/selection/route.ts
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn/ui components
│   │   ├── features/
│   │   │   ├── products/             # ProductTable, ProductDiff, ProductForm
│   │   │   ├── channels/             # ChannelList, ChannelProductTable
│   │   │   ├── warehouses/           # WarehouseList, WarehouseDetail, StockTable
│   │   │   ├── orders/               # OrderList, OrderForm, OrderDetail
│   │   │   ├── suppliers/            # SupplierList, SupplierDetail
│   │   │   ├── analyze/              # InconsistencyReport, FixAction
│   │   │   ├── sync/                 # PushPanel, SyncLog
│   │   │   ├── tiktok/               # TikTokSelection
│   │   │   └── dashboard/            # HealthStatus, DailySyncStatus, RecentLogs
│   │   └── layouts/
│   │       └── Sidebar.tsx
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts             # Drizzle D1 client
│   │   │   └── schema.ts             # All table definitions
│   │   ├── connectors/
│   │   │   ├── types.ts              # PlatformConnector + WarehouseConnector interfaces
│   │   │   ├── woocommerce.ts        # WooCommerceConnector
│   │   │   ├── shopify.ts            # ShopifyConnector (reused x2)
│   │   │   ├── acer-scraper.ts       # AcerStoreConnector (web scraping)
│   │   │   └── registry.ts          # getConnector(platform) + getWarehouseConnector(id)
│   │   ├── functions/
│   │   │   ├── products.ts           # createProduct, updateProduct, deleteProduct
│   │   │   ├── images.ts             # setProductImages, addProductImages, etc.
│   │   │   ├── prices.ts             # updateProductPrice
│   │   │   ├── categories.ts         # assignCategories
│   │   │   ├── import.ts             # importFromPlatform
│   │   │   ├── analyze.ts            # analyzeInconsistencies
│   │   │   ├── warehouses.ts         # syncWarehouse, overrideStock
│   │   │   ├── orders.ts             # createOrder, updateOrder, reconcileOrders
│   │   │   └── health.ts             # runApiHealthCheck
│   │   ├── automation/
│   │   │   └── daily-sync.ts         # Daily cron: sync warehouses + push channels + reconcile
│   │   ├── auth/
│   │   │   └── bearer.ts             # Bearer token validation middleware
│   │   └── utils/
│   │       ├── api-response.ts       # { data, meta } / { error, meta }
│   │       └── rate-limiter.ts       # Shopify 2 req/s limiter
│   │
│   ├── hooks/
│   │   ├── use-products.ts
│   │   ├── use-channels.ts
│   │   ├── use-warehouses.ts
│   │   ├── use-orders.ts
│   │   ├── use-suppliers.ts
│   │   ├── use-analyze.ts
│   │   └── use-sync-logs.ts
│   │
│   └── types/
│       ├── platform.ts               # Platform, SyncResult, ImageInput, TriggeredBy
│       ├── product.ts                # Product, Variant, ProductImage, etc.
│       ├── warehouse.ts              # Warehouse, WarehouseStock, WarehouseConnector
│       ├── order.ts                  # Order, OrderItem, ArrivalStatus
│       ├── supplier.ts               # Supplier
│       └── analysis.ts               # InconsistencyReport, InconsistencyType
│
├── drizzle/                          # Drizzle migrations
├── public/
└── tests/
    ├── connectors/                   # WooCommerce, Shopify, AcerScraper
    └── functions/                    # Business function unit tests
```

---

## Connector Architecture (Extensible)

### Platform Connector (sales channels)
```typescript
interface PlatformConnector {
  importProducts(): Promise<RawProduct[]>
  getProduct(platformId: string): Promise<RawProduct>
  createProduct(data: ProductPayload): Promise<string>
  updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void>
  deleteProduct(platformId: string): Promise<void>
  setImages(platformId: string, images: ImageInput[]): Promise<void>
  addImages(platformId: string, images: ImageInput[]): Promise<void>
  deleteImages(platformId: string): Promise<void>
  updatePrice(platformId: string, price: number, compareAt?: number): Promise<void>
  toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void>
  assignCategories(platformId: string, categoryIds: string[]): Promise<void>
  healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }>
}
```

### Warehouse Connector (stock sources)
```typescript
interface WarehouseConnector {
  getStock(): Promise<WarehouseStockSnapshot[]>  // { sku, quantity }[]
  healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }>
  // Note: only ACER Store connector implements a writeStock method
}
```

### Registry
```typescript
export function getConnector(platform: Platform): PlatformConnector {
  switch (platform) {
    case 'woocommerce':        return new WooCommerceConnector(...)
    case 'shopify_komputerzz': return new ShopifyConnector(SHOPIFY_KOMPUTERZZ_SHOP, ...)
    case 'shopify_tiktok':     return new ShopifyConnector(SHOPIFY_TIKTOK_SHOP, ...)
    case 'platform_4':         throw new Error('platform_4 connector not implemented')
    case 'platform_5':         throw new Error('platform_5 connector not implemented')
  }
}

export function getWarehouseConnector(warehouseId: string): WarehouseConnector {
  switch (warehouseId) {
    case 'ireland':    return new ShopifyWarehouseConnector(SHOPIFY_TIKTOK_SHOP, ...) // reads stock from TikTok Shopify
    case 'poland':     throw new Error('Poland warehouse connector not yet implemented')
    case 'acer_store': return new AcerScraperConnector(...)
    case 'spain':      throw new Error('Spain warehouse connector not yet implemented')
  }
}
```

---

## Data Flows

### Daily Automation Flow (Cloudflare Cron)
```
1. For each warehouse with auto_sync = 1:
   a. Call getWarehouseConnector(id).getStock()
   b. Upsert into warehouse_stock
   c. Update warehouses.last_synced
   d. Log to sync_log (action: 'sync_warehouse', triggered_by: 'system')

2. Reconcile orders:
   a. For each open purchase order (arrival_status = 'pending'):
   b. Compare current warehouse_stock.quantity vs last snapshot
   c. If qty increased >= order qty → mark 'arrived'
   d. If qty increased but < order qty → mark 'partial'
   e. Update order_items.quantity_received, update warehouse_stock.quantity_ordered

3. Push to channels (configurable per channel):
   a. For channels with auto_push = true (not TikTok — auto-updated by warehouse):
   b. Compare warehouse_stock with platform stock
   c. Call connector.updateStock(platformId, qty) or connector.toggleStatus()
   d. Log to sync_log (triggered_by: 'system')

4. Write daily_sync_log entry with status + summary
```

### API Health Check Flow
```
1. For each platform connector:
   a. Measure latency of a lightweight read call
   b. Attempt a reversible write (e.g. update a test product field then revert)
   c. Record ok/error + latency_ms

2. For each warehouse connector:
   a. Call healthCheck()
   b. Record ok/error + latency_ms

3. Total duration measured
4. Write to api_health_log (JSON results)
5. Latest result shown on / (home page dashboard)
```

### Import Flow (Komputerzz source of truth)
```
1. POST /api/import/shopify_komputerzz
2. ShopifyConnector fetches all products (paginated, rate-limited)
   → products, variants, images, collections, metafields, tax codes
3. Upsert into D1 + populate platform_mappings
4. sync_log entry: action='import', triggered_by='agent'|'human'
5. Return: { imported, updated, skipped, errors }
```

### Push Flow (human or agent)
```
1. API call with { fields, platforms[], triggeredBy }
2. Bearer token validated
3. For each platform:
   a. Look up platform_id from platform_mappings
   b. Call getConnector(platform).updateProduct(...)
   c. Log to sync_log (triggered_by from request)
4. Return SyncResult[]
```

---

## Security

| Concern | Mitigation |
|---------|------------|
| Web UI access | Cloudflare Access (SSO) — no credentials in the app |
| API access | Bearer token required on all /api/* routes |
| Secrets | All API keys in Cloudflare env vars (never in D1 or code) |
| SQL injection | Drizzle ORM parameterized queries |
| XSS | React auto-escaping |
| Audit trail | Every write operation logged in sync_log |
| Warehouse write guard | Connectors for read-only warehouses (ireland, poland) do not expose write methods |

---

## Architectural Decision Records

### ADR-001: Cloudflare D1 over PostgreSQL
- **Decision:** Use D1 (SQLite) — free tier, native to Pages/Workers
- **Consequences:** No RLS, acceptable for ~300 products + warehouse/order data

### ADR-002: Komputerzz as source of truth
- **Decision:** Import Komputerzz first, all fields, then compare others against it
- **Consequences:** Komputerzz data quality determines master quality

### ADR-003: PlatformConnector interface for extensibility
- **Decision:** All connectors implement a shared interface; `getConnector()` resolves at runtime
- **Consequences:** Adding a new platform = one new file + one registry entry

### ADR-004: No AI in the application layer
- **Decision:** No LLM calls inside the app. Claude connects as an external agent via REST API.
- **Consequences:** All operations are deterministic and logged

### ADR-005: Cloudflare Access for web UI auth
- **Decision:** Cloudflare Access (SSO) instead of custom email/password auth
- **Consequences:** Zero auth code in the app, managed at the edge

### ADR-006: ACER Store via scraping
- **Decision:** No native API available. Web scraping (Playwright or Claude agent) is the only option.
- **Consequences:** Fragile if ACER Store changes their UI. Implementation TBD — placeholder in schema and connectors.

### ADR-007: Warehouses and channels are separate
- **Decision:** Warehouse = physical stock source. Channel = where products are sold. They are independent with a rules table for restrictions (e.g. Spain → TikTok only).
- **Consequences:** Flexible architecture for future warehouses and channels. Some complexity in routing stock push logic.

### ADR-008: Daily sync via Cloudflare Cron Triggers
- **Decision:** Use Cloudflare Cron Triggers for daily automation (warehouse sync, channel push, order reconciliation, API health check).
- **Consequences:** No long-running processes. Each job must complete within Workers time limits.
