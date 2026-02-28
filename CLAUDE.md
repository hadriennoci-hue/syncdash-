Read actor developement and ultimate scraper skill.md files. I should prioritize calling them if the tasks need it.
# CLAUDE.md

> Rules and patterns for AI assistants working on this codebase

## Project Overview

**Name:** Wizhard
**Description:** Internal dashboard to sync product catalogues across COINCART.STORE (WooCommerce), KOMPUTERZZ.COM (Shopify), and a TikTok Shop Shopify account — plus warehouse stock management (Ireland, Poland, ACER Store), supplier tracking, and purchase order management.
**Stack:** Next.js 14, TypeScript, Tailwind, shadcn/ui, Drizzle ORM, Cloudflare Workers, Cloudflare D1, Cloudflare R2
**Auth:** Cloudflare Access (SSO) for the web UI. Bearer token for all `/api/*` routes.
Cloudflare runtime architecture: Worker uses D1 binding `DB` (`syncdash-db`) for app data and R2 binding `R2_IMAGES` (`syncdash-images`) for product media; browser channels (`xmr_bazaar`, `libre_market`) are manual/local script pushes.
Live Worker ops: script name `syncdash`, custom domain `wizhard.store`, workers.dev subdomain `hadrien-noci`, cron schedules at `0 5 * * *` (daily sync) and `0 6 * * *` (daily health check).

---

## Critical Rules — Read First

### No AI in the application
This app is 100% deterministic. Do NOT add Claude API calls, LLM calls, or any AI-powered logic inside the app code. Claude connects as an **external agent via the REST API** — the app just executes what it's told.

### Every platform write goes through a connector
Never call WooCommerce or Shopify APIs directly from a route handler. Always go through `getConnector(platform)` from `src/lib/connectors/registry.ts`.

### Every warehouse operation goes through a warehouse connector
Never call Shopify or scraping logic directly for warehouse stock. Use `getWarehouseConnector(warehouseId)` from `src/lib/connectors/registry.ts`.

### Every write operation must be logged
Every function that modifies data on a platform or warehouse must write to `sync_log`. Use `triggeredBy: 'human' | 'agent' | 'system'` based on the request context. See `src/lib/functions/log.ts`.

### Ireland warehouse — dual role (read carefully)
The Ireland warehouse and the TikTok Shop share the **same Shopify account** (`SHOPIFY_TIKTOK_SHOP`) but serve two distinct purposes:

1. **`ireland` warehouse** — a physical stock location. Stock is auto-updated by Shopify when deliveries arrive. Wizhard reads this stock via `ShopifyWarehouseConnector` using `SHOPIFY_TIKTOK_IRELAND_LOCATION_ID`. This stock feeds **all sales channels** (WooCommerce, Komputerzz, TikTok) according to `warehouse_channel_rules`.

2. **`shopify_tiktok` platform** — a sales channel (point of sale). It sells products and draws its available stock from the Ireland warehouse. It is configured as a platform connector (`ShopifyConnector`) for pushing catalogue updates, prices, and status.

**Same Shopify account, two connectors, two roles.** Never confuse the two:
- Reading Ireland stock → `getWarehouseConnector('ireland')` → `ShopifyWarehouseConnector`
- Pushing products/prices/status to TikTok Shop → `getConnector('shopify_tiktok')` → `ShopifyConnector`
- `SHOPIFY_TIKTOK_LOCATION_ID` and `SHOPIFY_TIKTOK_IRELAND_LOCATION_ID` currently point to the same location (the account has one location), but they are kept separate because that may change.

### Warehouse write guard — ENFORCE THIS
- **ACER Store:** read + write allowed (`canModifyStock = 1`)
- **Ireland:** read only — do NOT write stock (`canModifyStock = 0`)
- **Poland:** read only — do NOT write stock (`canModifyStock = 0`)
- Always check `warehouse.canModifyStock` before writing. Return 403 if false.
- Wizhard MAY always write `quantity_ordered` and `last_order_date` for any warehouse.
- Guard is implemented in `src/lib/functions/warehouses.ts`.

### Wizhard D1 is the master catalogue (after initial import)
After the one-time Komputerzz import, **Wizhard D1 is the source of truth**. New products are created in Wizhard and pushed to channels. Komputerzz is a channel like the others — it receives pushes, it is no longer the source. Never pull from Komputerzz to overwrite D1 data outside of an explicit re-import operation.

### Shopify category = Electronics (tax classification, NOT collections)
When pushing any product to a Shopify sales channel (`shopify_komputerzz`, `shopify_tiktok`), the Shopify **product category** must be set to **"Electronics"**. This is Shopify's standardised taxonomy field used for **tax purposes** — it is NOT the same as collections.

Mapping clarification:
- **Shopify Collections** = equivalent to **WooCommerce Categories** (content/navigation grouping)
- **Shopify Category** (taxonomy) = a separate tax classification field → always set to `"Electronics"` for all our products

Never omit this field when creating or updating products on Shopify. It has no equivalent in WooCommerce.

### SKU is the universal key
`products.id` is the SKU. All platform IDs are stored in `platform_mappings`. Never use platform-native IDs as the primary reference — always use SKU.

### Extensible platform list
The `Platform` type must be a string enum (`src/types/platform.ts`). Adding a new platform = new connector + one line in the registry. No other files should need changes.

### Extensible warehouse list
Same pattern as platforms. Adding a warehouse = implement `WarehouseConnector` + one line in `getWarehouseConnector()` in `src/lib/connectors/registry.ts`.

### pendingReview flag
When a product is auto-created from ACER Store scraping (new SKU found in stock with no D1 record), it is created with `pendingReview: 1`. The home page surfaces these for manual verification before publishing. Always set `pendingReview: 1` on auto-created products; never set it on manually created ones.

### Browser channels runtime (local only)
- `xmr_bazaar` and `libre_market` are browser channels and are processed by the local script/runner (`scripts/push-browser-channels.ts`), not by Worker connectors.
- Push lifecycle for browser channels is `2push -> done/FAIL` in `products` push-status fields.
- End-of-run reconciliation:
  - XMR: listings not opened during the run are set to `Out of Stock`.
  - Libre: listings not opened during the run are edited with stock `0`.

### Missing mapped listing/product recovery
- If a mapped browser listing is missing remotely (`Listing not found` / `Produit non trouvé`), recreate from scratch and replace `platform_mappings.platform_id` with the new ID.
- For API channels (Shopify/WooCommerce), if mapped ID update fails, fallback is: search by SKU -> remap and update; if SKU not found -> create and remap.

### ACER health check nuance
- Direct server-side fetch to ACER URLs may fail due to JS/challenge/consent flow.
- Health check uses progressive URL attempts (`3s/5s/7s/10s`) and still verifies Firecrawl communication.
- If Firecrawl succeeds, ACER is considered healthy even when direct URL fetch is blocked.

### Local runner behavior
- Runner watches `/api/runner/wake` and triggers browser push quickly on wake signal; fallback cycle remains available.
- Idle heartbeat is logged every 5 minutes so background wait state is visible.

---

## Environment Variables

All secrets live in `.env.local` / `.dev.vars` (local dev) or Cloudflare Worker secrets/vars (production).
For local Cloudflare/Wrangler runs, `.dev.vars` stores local auth and environment values and must never be committed.

```bash
# API auth
AGENT_BEARER_TOKEN=                        # server-side bearer check (verifyBearer)
NEXT_PUBLIC_AGENT_BEARER_TOKEN=            # client-side API calls (apiFetch)

# WooCommerce — coincart.store
WOO_BASE_URL=                              # e.g. https://coincart.store
WOO_CONSUMER_KEY=
WOO_CONSUMER_SECRET=

# Shopify — komputerzz.com
SHOPIFY_KOMPUTERZZ_SHOP=                   # e.g. komputerzz.myshopify.com
SHOPIFY_KOMPUTERZZ_TOKEN=
SHOPIFY_KOMPUTERZZ_LOCATION_ID=            # optional — falls back to primary location

# Shopify — TikTok account
SHOPIFY_TIKTOK_SHOP=
SHOPIFY_TIKTOK_TOKEN=
SHOPIFY_TIKTOK_LOCATION_ID=                # optional — falls back to primary location
SHOPIFY_TIKTOK_IRELAND_LOCATION_ID=        # required for Ireland warehouse stock sync

# ACER Store scraping
ACER_STORE_SCRAPE_URLS=                    # comma-separated list of pages to scrape
FIRECRAWL_API_KEY=                         # used by channel-sync and acer-scraper

# Cloudflare R2
R2_PUBLIC_URL=                             # public base URL for uploaded images
```

---

## Code Style & Conventions

### General
- TypeScript strict mode — no `any`, use `unknown` if needed
- Prefer `const` over `let`, never `var`
- Use early returns to reduce nesting
- Maximum function length: ~50 lines (extract if longer)
- Maximum file length: ~300 lines (split if longer)
- No `console.log` in production code — use `logOperation` from `src/lib/functions/log.ts`

### Naming
```typescript
// Variables and functions: camelCase
const productSku = 'SKU-001'
function getProductBySku(sku: string) {}

// Types and interfaces: PascalCase
interface ProductPayload {}
type SyncResult = { warehouseId: string; productsUpdated: number }

// Constants: SCREAMING_SNAKE_CASE
const MAX_SHOPIFY_RATE = 2  // requests per second

// Files: kebab-case
// woocommerce-connector.ts, acer-scraper.ts

// React components: PascalCase files
// ProductTable.tsx, WarehouseDetail.tsx
```

### Import Order
```typescript
// 1. React/Next
import { useState } from 'react'
import { NextRequest } from 'next/server'

// 2. External libraries
import { z } from 'zod'
import { eq } from 'drizzle-orm'

// 3. Internal absolute imports
import { db } from '@/lib/db/client'
import { products, syncLog } from '@/lib/db/schema'
import { getConnector } from '@/lib/connectors/registry'

// 4. Relative imports
import { ProductRow } from './product-row'
import type { Platform } from './types'
```

---

## API Route Pattern

```typescript
// src/app/api/products/[sku]/route.ts
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'

const patchSchema = z.object({
  fields: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'archived']).optional(),
    isFeatured: z.boolean().optional(),
  }),
  platforms: z.array(z.string()),
  triggeredBy: z.enum(['human', 'agent']).default('human'),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  // 1. Auth
  const authError = verifyBearer(req)
  if (authError) return authError

  // 2. Validate
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', parsed.error.message, 400)
  }

  // 3. Business logic (via lib/functions/)
  const results = await updateProduct(params.sku, parsed.data)

  // 4. Return
  return apiResponse(results, 200)
}
```

---

## Connector Pattern

```typescript
// src/lib/connectors/shopify.ts
export class ShopifyConnector implements PlatformConnector {
  constructor(private shop: string, private token: string) {}

  async importProducts(): Promise<RawProduct[]> { ... }
  async updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void> { ... }
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> { ... }
  // ... implement all PlatformConnector methods
}

// src/lib/connectors/acer-scraper.ts
export class AcerScraperConnector implements WarehouseConnector {
  async getStock(): Promise<WarehouseStockSnapshot[]> {
    // Web scraping via Firecrawl
    // Returns [{ sku, quantity, sourceUrl, sourceName }]
  }
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> { ... }
}

// src/lib/connectors/registry.ts
export function getConnector(platform: Platform): PlatformConnector { ... }
export function getWarehouseConnector(warehouseId: string): WarehouseConnector { ... }
```

---

## Business Function Pattern

```typescript
// src/lib/functions/warehouses.ts
export async function syncWarehouse(
  warehouseId: string,
  triggeredBy: TriggeredBy = 'system'
): Promise<{ warehouseId: string; productsUpdated: number; errors: string[]; syncedAt: string }> {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId)
  })
  if (!warehouse) throw new Error(`Warehouse not found: ${warehouseId}`)

  const connector = getWarehouseConnector(warehouseId)
  const stock = await connector.getStock()

  // Upsert warehouse_stock
  // Update warehouse.last_synced
  // Log to sync_log (action: 'sync_warehouse', triggered_by)
  // Return { warehouseId, productsUpdated, errors, syncedAt }
}

export async function overrideWarehouseStock(
  warehouseId: string,
  productId: string,
  data: StockOverride,
  triggeredBy: TriggeredBy = 'human'
): Promise<void> {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId)
  })
  if (!warehouse?.canModifyStock) {
    throw new Error(`Warehouse ${warehouseId} is read-only`)
  }
  // ... update + log
}
```

---

## Import Modes

`POST /api/import/:platform` accepts a `mode` field:

| Mode | Behaviour |
|------|-----------|
| `new_changed` | Default. Upserts only — creates new SKUs and updates existing ones. Does not delete. |
| `full` | Full re-import. Replaces all data for every product fetched from the platform. |

```json
{ "mode": "full", "triggeredBy": "human" }
```

---

## Database Pattern

```typescript
// Always use Drizzle — never raw SQL strings
import { db } from '@/lib/db/client'
import { products, platformMappings, warehouseStock } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// Query with relations
const product = await db.query.products.findFirst({
  where: eq(products.id, sku),
  with: {
    variants: true,
    images: true,
    prices: true,
    metafields: true,
    platformMappings: true,
  }
})

// Upsert stock
await db.insert(warehouseStock)
  .values({ productId: sku, warehouseId, quantity, updatedAt: new Date().toISOString() })
  .onConflictDoUpdate({
    target: [warehouseStock.productId, warehouseStock.warehouseId],
    set: { quantity, updatedAt: new Date().toISOString() }
  })
```

---

## UI Patterns

### Clickable cross-references (required everywhere)
- SKUs must always render as a link → `/products/[sku]`
- Channel names must render as links → `/channels/[id]`
- Warehouse names must render as links → `/warehouses/[id]`
- Supplier names must render as links → `/suppliers/[id]`
- Order/invoice numbers must render as links → `/orders/[id]`

### Product table status badges
```
Published    → green badge
Out of stock → yellow badge
Disabled     → gray badge
Absent       → no badge (dash)
```

### Localization display
- Derived from `country_layout` collections (not stored as column)
- Display: `ITA`, `FRA`, `POR`, `SPA`, `GER`, `UK`, `CHE`, `SWE`, or `—`

---

## Testing

### What to Test
- Connector logic: mock API calls, verify normalization
- Business functions: mock connector, verify DB writes + log entries
- API routes: verify auth, validation, correct function called
- Warehouse guard: verify 403 on write attempt to read-only warehouse

### Test Structure
```typescript
// tests/functions/warehouses.test.ts
describe('overrideWarehouseStock', () => {
  it('updates stock for writable warehouse (acer_store)', async () => { ... })
  it('throws for read-only warehouse (ireland)', async () => { ... })
})
```

---

## Do NOT

- ❌ Use `any` type — use `unknown` if the shape is truly unknown
- ❌ Leave `console.log` in production code — use `logOperation` from `src/lib/functions/log.ts`
- ❌ Hardcode platform URLs, tokens, or warehouse addresses — use env vars (see list above)
- ❌ Skip Zod validation on any API route input
- ❌ Add auth logic to the app — Cloudflare Access handles UI auth, `verifyBearer` handles API auth
- ❌ Return `NextResponse` directly from route handlers — always use `apiResponse` / `apiError`

---

## Commands

```bash
# Development
# Two modes — choose based on what you need:
# Agent rule: if user asks to "start local server", assume full stack with databases (use `npm run dev:cf`).
npm run dev            # UI only — fast HMR, no D1 (all API routes return 500)
npm run dev:cf         # Full stack worker runtime (OpenNext build + Wrangler dev)
                       # Slower (requires full build) but D1 + all bindings work
                       # Run db:migrate + db:seed first if local DB is empty
npm run build          # Build app artifacts
npm run deploy         # Deploy Worker via OpenNext/Cloudflare

# Quality
npm run lint           # ESLint
npm run type-check     # TypeScript check
npm run test           # Vitest unit tests

# Database — run all in order on first setup
npm run db:bootstrap   # Recommended local bootstrap (applies migrations + seed, tolerant on re-runs)
npm run db:migrate     # Migration 1 — base schema
npm run db:migrate2    # Migration 2 — product custom fields
npm run db:migrate4    # Migration 4 — warehouse channel priority
npm run db:migrate5    # Migration 5 — warehouse_stock source_url/source_name + pending_review
npm run db:migrate6    # Migration 6 — suppliers contact_first_name/contact_last_name
npm run db:migrate7    # Migration 7 — products pushed_woocommerce/pushed_shopify_komputerzz/pushed_shopify_tiktok
npm run db:migrate8    # Migration 8 — drop deprecated short_description
npm run db:migrate9    # Migration 9 — warehouse_stock import_price/import_promo_price
npm run db:seed        # Seed suppliers + warehouses + channel rules
npm run db:studio      # Drizzle Studio (visual DB browser)
npm run db:generate    # Generate new migration from schema changes

# Wrangler (Cloudflare)
npx wrangler d1 list                          # List D1 databases
npx wrangler d1 execute syncdash-db --local   # Run SQL locally
```

---

## Ops Runbook (Quick)

Use these read-only checks at the start of future sessions when needed:

```bash
# Auth/account
npx wrangler whoami

# Worker status
npx wrangler deployments status --name syncdash
npx wrangler deployments list --name syncdash

# Data stores
npx wrangler d1 list
npx wrangler d1 execute syncdash-db --remote --command "SELECT COUNT(*) AS products FROM products;"
npx wrangler r2 bucket info syncdash-images
npx wrangler r2 bucket dev-url get syncdash-images
```

---

## Resources

- [Plan](./plan_final.md)
- [Spec](./spec.md)
- [Architecture](./architecture.md)
- [Database Schema](./database-schema.md)
- [API Contracts](./api-contracts.md)
- [Tech Stack](./tech-stack.md)
- [User Flows](./user-flows.md)

---

## Deferred Decisions (Remind Next Sessions)

- Wrangler upgrade to v4: deferred for now (do not perform yet; remind before future deploy/tooling changes).
- `/api/cron` hardening (scheduled-only enforcement): deferred for now (keep current behavior; revisit later).
- Add a short ops runbook section only if it will help continuity across future sessions.

## Session Shortcut Rule

- If the user asks for **"Test restart"**, always execute this full sequence in order:
  1. Close every running instance of the local test server.
  2. Close every running instance of the local browser runner.
  3. Close all open PowerShell windows.
  4. Clear the local **product database data only** (products and dependent product tables; keep config/reference tables).
  5. Restart the local test server.
  6. Restart the local browser runner.
  7. Sync **Ireland** warehouse only.
- Runner visibility constraint (current user preference):
  - Always launch runner in a **visible terminal window**.
  - Always run browser automation in **headed mode** (browser windows visible), not headless.
