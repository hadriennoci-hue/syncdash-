# Tech Stack

## Overview

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Next.js 14 (App Router) | Compatible Cloudflare Pages, TypeScript, SSR |
| Backend | Next.js API Routes on Cloudflare Workers | Native to Pages, zero cost |
| Database | Cloudflare D1 (SQLite) | Free tier, sufficient for ~300 products |
| ORM | Drizzle ORM | Lightweight, D1-compatible, TypeScript-first |
| UI Components | shadcn/ui + Radix | Accessible, unstyled primitives |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| State (server) | React Query (TanStack Query) | Data fetching, cache, sync state |
| Auth | Bearer token (static, env var) | Internal tool — no user management needed |
| Hosting | Cloudflare Pages | Free, global CDN, integrated with D1/Workers |

## Frontend

### Framework
- **Choice:** Next.js 14 with App Router
- **Rationale:** Works on Cloudflare Pages via `@cloudflare/next-on-pages`, TypeScript support, server components reduce client JS
- **Alternatives Considered:** Remix (less ecosystem), plain React+Vite (no SSR)

### Styling
- **Choice:** Tailwind CSS
- **Component Library:** shadcn/ui (copy-paste components, not a package dependency)
- **Rationale:** shadcn gives us full control over component code; Tailwind keeps styles collocated

### State Management
- **Server state:** React Query — all product/sync data fetched and cached via `useQuery` / `useMutation`
- **UI state:** React `useState` / `useReducer` — no global store needed for this tool
- **No Zustand / Redux** — overkill for a single-user internal dashboard

## Backend

### Runtime
- **Choice:** Cloudflare Workers (via Next.js API routes deployed on Cloudflare Pages)
- **Rationale:** Native to the hosting platform, no cold starts on Workers, free tier generous

### API Style
- **Choice:** REST
- **Rationale:** Simple, stateless, easy to call from both the frontend and an AI agent. No need for GraphQL complexity.

### Connector Architecture
All platform connectors implement a shared `PlatformConnector` interface:
```typescript
interface PlatformConnector {
  importProducts(): Promise<RawProduct[]>
  getProduct(platformId: string): Promise<RawProduct>
  createProduct(data: ProductPayload): Promise<string>         // returns platformId
  updateProduct(platformId: string, data: Partial<ProductPayload>): Promise<void>
  deleteProduct(platformId: string): Promise<void>
  setImages(platformId: string, images: ImageInput[]): Promise<void>
  addImages(platformId: string, images: ImageInput[]): Promise<void>
  deleteImages(platformId: string): Promise<void>
  updatePrice(platformId: string, price: number, compareAt?: number): Promise<void>
  toggleStatus(platformId: string, status: 'active' | 'archived'): Promise<void>
  assignCategories(platformId: string, categoryIds: string[]): Promise<void>
}
```

**Current connectors:**
- `WooCommerceConnector` — REST API, Consumer Key/Secret
- `ShopifyConnector` — GraphQL Admin API, reused for both Shopify accounts
- *(Future)* `Platform4Connector`, `Platform5Connector` — implement same interface

## Database

### Primary Database
- **Choice:** Cloudflare D1 (SQLite)
- **Rationale:** Free, integrated with Cloudflare Pages/Workers, zero ops, sufficient for ~300 products and their variants/images

### ORM
- **Choice:** Drizzle ORM
- **Rationale:** Native D1 support, type-safe queries, migrations via `drizzle-kit`, lightweight (~30KB)
- **Alternatives Considered:** Prisma (no D1 support), Kysely (less ergonomic for this scale)

### Migrations
- Managed by `drizzle-kit`
- Run via `npm run db:migrate` locally and on deploy
- All migrations versioned in `/drizzle/` folder

## Third-Party Services

| Service | Provider | Purpose |
|---------|----------|---------|
| E-commerce platform #1 | WooCommerce REST API | coincart.store catalogue |
| E-commerce platform #2 | Shopify Admin API | komputerzz.com catalogue (source of truth) |
| E-commerce platform #3 | Shopify Admin API | TikTok Shop catalogue |
| Image hosting | Platform-native | Images stay on source platform (no re-hosting) |

**No:** Stripe, email providers, analytics, error tracking — internal tool, not needed for v1.

## Development Tools

| Tool | Purpose |
|------|---------|
| TypeScript (strict) | Type safety across connectors, API, DB |
| ESLint + Prettier | Code quality and formatting |
| Vitest | Unit tests for connector logic and business functions |
| Drizzle Kit | Database migrations and schema management |
| Wrangler (Cloudflare CLI) | Local D1 dev, deploy |

## Environment Requirements

```bash
Node.js >= 18.0
npm >= 9.0
Wrangler CLI >= 3.0 (for Cloudflare D1 local dev)
```

## Key Dependencies

```json
{
  "dependencies": {
    "next": "14.x",
    "drizzle-orm": "latest",
    "@cloudflare/next-on-pages": "latest",
    "@tanstack/react-query": "^5",
    "zod": "^3",
    "clsx": "^2",
    "tailwind-merge": "^2"
  },
  "devDependencies": {
    "drizzle-kit": "latest",
    "wrangler": "^3",
    "typescript": "^5",
    "vitest": "^1",
    "eslint": "^8",
    "prettier": "^3"
  }
}
```

## Environment Variables

```bash
# App
NEXT_PUBLIC_APP_URL=https://syncdash.pages.dev
AGENT_BEARER_TOKEN=<static-secret-token>     # Used by AI agent to call the API

# WooCommerce — coincart.store
COINCART_URL=https://coincart.store
COINCART_KEY=ck_xxx
COINCART_SECRET=cs_xxx

# Shopify — komputerzz.com (source of truth)
SHOPIFY_KOMPUTERZZ_SHOP=komputerzz.myshopify.com
SHOPIFY_KOMPUTERZZ_TOKEN=shpat_xxx

# Shopify — TikTok Shop account
SHOPIFY_TIKTOK_SHOP=tiktok-account.myshopify.com
SHOPIFY_TIKTOK_TOKEN=shpat_xxx

# Future platforms (add when needed)
# PLATFORM_4_BASE_URL=
# PLATFORM_4_API_KEY=
```
