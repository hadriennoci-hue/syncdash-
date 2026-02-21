# CLAUDE.md

> Rules and patterns for AI assistants working on this codebase

## Project Overview

**Name:** SyncDash
**Description:** Internal dashboard to sync product catalogues across COINCART.STORE (WooCommerce), KOMPUTERZZ.COM (Shopify), and a TikTok Shop Shopify account — plus warehouse stock management (Ireland, Poland, ACER Store), supplier tracking, and purchase order management.
**Stack:** Next.js 14, TypeScript, Tailwind, shadcn/ui, Drizzle ORM, Cloudflare D1, Cloudflare Pages
**Auth:** Cloudflare Access (SSO) for the web UI. Bearer token for all `/api/*` routes.

---

## Critical Rules — Read First

### No AI in the application
This app is 100% deterministic. Do NOT add Claude API calls, LLM calls, or any AI-powered logic inside the app code. Claude connects as an **external agent via the REST API** — the app just executes what it's told.

### Every platform write goes through a connector
Never call WooCommerce or Shopify APIs directly from a route handler. Always go through `getConnector(platform)` from `src/lib/connectors/registry.ts`.

### Every warehouse operation goes through a warehouse connector
Never call Shopify or scraping logic directly for warehouse stock. Use `getWarehouseConnector(warehouseId)` from `src/lib/connectors/registry.ts`.

### Every write operation must be logged
Every function that modifies data on a platform or warehouse must write to `sync_log`. Use `triggeredBy: 'human' | 'agent' | 'system'` based on the request context.

### Warehouse write guard — ENFORCE THIS
- **ACER Store:** read + write allowed (`canModifyStock = 1`)
- **Ireland:** read only — do NOT write stock (`canModifyStock = 0`)
- **Poland:** read only — do NOT write stock (`canModifyStock = 0`)
- Always check `warehouse.canModifyStock` before writing. Return 403 if false.
- Syncdash MAY always write `quantity_ordered` and `last_order_date` for any warehouse.

### SyncDash D1 is the master catalogue (after initial import)
After the one-time Komputerzz import, **SyncDash D1 is the source of truth**. New products are created in SyncDash and pushed to channels. Komputerzz is a channel like the others — it receives pushes, it is no longer the source. Never pull from Komputerzz to overwrite D1 data outside of an explicit re-import operation.

### SKU is the universal key
`products.id` is the SKU. All platform IDs are stored in `platform_mappings`. Never use platform-native IDs as the primary reference — always use SKU.

### Extensible platform list
The `Platform` type must be a string enum. Adding a new platform = new connector + one line in the registry. No other files should need changes.

### Extensible warehouse list
Same pattern as platforms. Adding a warehouse = implement `WarehouseConnector` + one line in `getWarehouseConnector()`.

---

## Code Style & Conventions

### General
- TypeScript strict mode — no `any`, use `unknown` if needed
- Prefer `const` over `let`, never `var`
- Use early returns to reduce nesting
- Maximum function length: ~50 lines (extract if longer)
- Maximum file length: ~300 lines (split if longer)

### Naming
```typescript
// Variables and functions: camelCase
const productSku = 'SKU-001'
function getProductBySku(sku: string) {}

// Types and interfaces: PascalCase
interface ProductPayload {}
type SyncResult = {}

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
import { NextRequest, NextResponse } from 'next/server'

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
import { NextRequest, NextResponse } from 'next/server'
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
  async healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }> { ... }
  // ... implement all PlatformConnector methods
}

// src/lib/connectors/acer-scraper.ts
export class AcerScraperConnector implements WarehouseConnector {
  async getStock(): Promise<WarehouseStockSnapshot[]> {
    // Web scraping implementation (Playwright or Claude agent)
    // Returns [{ sku, quantity }]
  }
  async healthCheck(): Promise<{ ok: boolean; latency_ms: number; error?: string }> { ... }
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
): Promise<{ productsUpdated: number; errors: string[] }> {
  const warehouse = await db.query.warehouses.findFirst({
    where: eq(warehouses.id, warehouseId)
  })
  if (!warehouse) throw new Error(`Warehouse not found: ${warehouseId}`)

  const connector = getWarehouseConnector(warehouseId)
  const stock = await connector.getStock()

  // Upsert warehouse_stock
  // Update warehouse.last_synced
  // Log to sync_log (action: 'sync_warehouse', triggered_by)
  // Return { productsUpdated, errors }
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

- ❌ Call Shopify/WooCommerce APIs directly from route handlers — go through connectors
- ❌ Call scraping logic directly — go through AcerScraperConnector
- ❌ Use `any` type
- ❌ Leave `console.log` in production code — use structured logging
- ❌ Hardcode platform URLs, tokens, or warehouse addresses — use env vars
- ❌ Write to a platform without logging to `sync_log`
- ❌ Write stock to Ireland or Poland warehouses — they are read-only
- ❌ Add AI/LLM calls inside the application
- ❌ Use `platform_id` as a primary reference — always use SKU
- ❌ Skip Zod validation on API inputs
- ❌ Add auth logic to the app — Cloudflare Access handles UI auth

---

## Do

- ✅ Always go through `getConnector(platform)` for platform operations
- ✅ Always go through `getWarehouseConnector(id)` for warehouse operations
- ✅ Always check `warehouse.canModifyStock` before writing stock
- ✅ Always log to `sync_log` after every write (success or error)
- ✅ Set `triggeredBy: 'human' | 'agent' | 'system'` on every log entry
- ✅ Return `SyncResult[]` from all push functions
- ✅ Handle rate limiting in connectors (Shopify: 2 req/s)
- ✅ Paginate all platform imports (WooCommerce max 100/page, Shopify cursor-based)
- ✅ Make all SKUs, channel names, warehouse names, supplier names, order numbers clickable
- ✅ Write tests for connector normalization and warehouse guard logic

---

## Commands

```bash
# Development
npm run dev            # Start dev server (Next.js + Wrangler D1)
npm run build          # Build for Cloudflare Pages
npm run deploy         # Deploy to Cloudflare Pages

# Quality
npm run lint           # ESLint
npm run type-check     # TypeScript check
npm run test           # Vitest unit tests

# Database
npm run db:generate    # Generate migration from schema changes
npm run db:migrate     # Apply migrations to local D1
npm run db:studio      # Drizzle Studio (visual DB browser)
npm run db:seed        # Seed dev database

# Wrangler (Cloudflare)
npx wrangler d1 list                       # List D1 databases
npx wrangler d1 execute syncdash --local   # Run SQL locally
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
