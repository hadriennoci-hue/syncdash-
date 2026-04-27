# README.md

Rules and patterns for AI assistants working on this codebase.

## Reminder: 2026-05-23

- Resume product translation rollout after Firecrawl credits reset.
- Follow the restart note: [translation-restart-2026-05-23.md](/C:/syncdash/docs/translation-restart-2026-05-23.md)

## 1) Fast Start (Read First)

- Project: `Wizhard` (internal product sync dashboard)
- Stack: Next.js 14, TypeScript, Tailwind, Drizzle ORM, Cloudflare Workers + D1 + R2
- Auth:
  - UI auth: Cloudflare Access
  - API auth: bearer token (`verifyBearer`) for `/api/*`
- Worker:
  - name: `syncdash`
  - custom domain: `wizhard.store`
  - workers.dev: `syncdash.hadrien-noci.workers.dev`
  - D1 binding: `DB` (`syncdash-db`)
  - R2 binding: `R2_IMAGES` (`syncdash-images`)
- This shell has working GitHub access via `gh` with `repo` and `workflow` scopes, so inspect Actions runs, deployments, and failures directly; same for Cloudflare access.

## 2) Core Business Model

- D1 is source of truth after initial import.
- SKU is universal key: `products.id` is SKU.
- Platform-native IDs live in `platform_mappings`.
- Coincart is a custom PostgreSQL sales channel; keep any `woocommerce` aliases only for backward compatibility.
- Komputerzz is a destination channel after initial import, not master.

## 3) Non-Negotiable Rules

### 3.0 Production-first rule
Everything we do is on production.
Never check the local DB for validation, investigation, or decision-making when production data is what matters.

### 3.1 No AI logic inside app runtime
Do not add LLM/AI calls inside app code. The app is deterministic. Agent logic is external via API.

### 3.2 Platform writes must use connectors
Never call Woo/Shopify APIs directly from route handlers.
Use `getConnector(platform)` / `createConnector(platform)` from:
- `src/lib/connectors/registry.ts`

### 3.3 Warehouse reads/writes must use warehouse connectors
Use `getWarehouseConnector(warehouseId)` / `createWarehouseConnector(warehouseId)` from:
- `src/lib/connectors/registry.ts`

### 3.4 Every write must be logged
All platform/warehouse mutations must write to `sync_log` using:
- `triggeredBy: 'human' | 'agent' | 'system'`
See:
- `src/lib/functions/log.ts`

### 3.5 Ireland dual-role rule (critical)
Same Shopify account, two roles:
- Warehouse stock read:
  - `ireland` -> `ShopifyWarehouseConnector` via `SHOPIFY_TIKTOK_IRELAND_LOCATION_ID`
- Sales channel write:
  - `shopify_tiktok` -> `ShopifyConnector`
Never mix these flows.

### 3.6 Warehouse write guard
All current warehouses are read-only for stock writes (`canModifyStock = 0`):
- `acer_store`
- `ireland`
- `poland`

Always enforce guard before stock override and return 403 when blocked.
Allowed even for read-only warehouses:
- update `quantity_ordered`
- update `last_order_date`

Implementation:
- `src/lib/functions/warehouses.ts`

### 3.7 Shopify category rule
When pushing to Shopify channels (`shopify_komputerzz`, `shopify_tiktok`), always set Shopify product category (taxonomy) to `Electronics`.
Do not confuse with collections.

### 3.8 Auto-created products from ACER scraping
When SKU exists in stock but not D1, auto-create product with:
- `pendingReview = 1`
Never set this on manual product creation.

### 3.9 Variant SKU rule
For variable products on any channel:
- parent SKU must be distinct from every child variant SKU
- every variant SKU must be distinct from every other variant SKU
- never reuse the parent SKU on a variant

### 3.10 Description format rule
All descriptions pushed to sales channels must be plain text with line breaks.
- Never push HTML descriptions to sales channels
- Never treat an HTML description as valid just because it is non-empty
- If a description contains HTML markers, treat it as missing/invalid and replace it with plain text

For Firecrawl / ACER Store extraction prompts:
- explicitly request plain-text descriptions with line breaks
- explicitly forbid HTML, tags, markdown, and rich text formatting

## 4) Channel Runtime Notes

### API channels
- `coincart2`
- `shopify_komputerzz`
- `shopify_tiktok`
- `ebay_ie`

### Browser channels (local runner only)
- `xmr_bazaar`
- `libre_market`

Processed by:
- `scripts/push-browser-channels.ts`
- `scripts/local-browser-runner.ts`

**IMPORTANT — browser runner rule:**
Do NOT run `push:browser` yourself unless the user explicitly asks you to run the push and confirms it.
When the user asks to "start the browser runner", always run:
```bash
npm run runner:browser
```
This starts the persistent polling runner (waits for queued products from Wizhard). `push:browser` is a one-shot push — never the right default.

Push status lifecycle for browser channels:
- `2push -> done | FAIL`

Missing listing recovery:
- Browser channels: recreate listing and replace `platform_mappings.platform_id`
- API channels: try update -> search by SKU and remap -> create if not found

## 5) Environment Variables

Use `.env.local` / `.dev.vars` locally. Never commit secrets.
Production uses Cloudflare Worker vars/secrets.

### Required keys (current naming)

```bash
# API auth
AGENT_BEARER_TOKEN=
NEXT_PUBLIC_AGENT_BEARER_TOKEN=

# Coincart
COINCART_URL=
COINCART_API_URL=
COINCART_KEY=
COINCART_SECRET=

# Shopify Komputerzz
SHOPIFY_KOMPUTERZZ_SHOP=
SHOPIFY_KOMPUTERZZ_TOKEN=
SHOPIFY_KOMPUTERZZ_LOCATION_ID=

# Shopify TikTok
SHOPIFY_TIKTOK_SHOP=
SHOPIFY_TIKTOK_TOKEN=
SHOPIFY_TIKTOK_LOCATION_ID=
SHOPIFY_TIKTOK_IRELAND_LOCATION_ID=

# ACER scraping
ACER_STORE_SCRAPE_URLS=
FIRECRAWL_API_KEY=

# R2
R2_PUBLIC_URL=
```

## 6) API Route Contract Pattern

For each route:
1. `verifyBearer`
2. parse + validate with Zod
3. call `src/lib/functions/*` business function
4. return `apiResponse` / `apiError`

Do not return raw `NextResponse` directly from routes.

## 7) Coding Standards

- TypeScript strict, no `any`
- Prefer early returns
- Prefer small functions/files
- No production `console.log` (use logging function)
- Use Drizzle ORM (no raw SQL strings in app code)

## 8) UI Requirements

Clickable references (always link):
- SKU -> `/products/[sku]`
- Channel -> `/channels/[id]`
- Warehouse -> `/warehouses/[id]`
- Supplier -> `/suppliers/[id]`
- Order/invoice -> `/orders/[id]`

## 9) Local Commands

```bash
# Dev
npm run dev            # UI only (no D1-backed APIs)
npm run dev:cf         # Full Worker runtime + bindings

# Build
npm run build          # CI-safe OpenNext build wrapper (creates .open-next/worker.js)
npm run build:next     # Plain Next.js build
npm run build:cf       # Alias of OpenNext build

# Deploy
npm run deploy         # OpenNext deploy wrapper

# Quality
npm run type-check
npm run lint
npm run test

# DB bootstrap
npm run db:bootstrap
```

## 10) Cloudflare CI/CD Deploy Recipe (Important)

If CI deploy command is `npx wrangler deploy`, CI build must be OpenNext build, not plain Next build.

Valid pairings:
- Build: `npm run build` (or `npm run build:cf`)
- Deploy: `npx wrangler deploy`

or

- Build: skip
- Deploy: `npm run deploy`

Common failure symptom:
- `The entry-point file at ".open-next/worker.js" was not found`

Cause:
- running `next build` before `wrangler deploy`.
- recursive OpenNext build loop when `npm run build` is misconfigured.

## 11) Ops Quick Checks

```bash
npx wrangler whoami
npx wrangler deployments status --name syncdash
npx wrangler deployments list --name syncdash
npx wrangler d1 list
npx wrangler d1 execute syncdash-db --remote --command "SELECT COUNT(*) AS products FROM products;"
npx wrangler r2 bucket info syncdash-images
```

## 12) Testing Expectations

Prioritize tests for:
- connector normalization + API error handling
- business functions (DB writes + `sync_log`)
- route auth + validation
- warehouse write guard behavior

## 13) Agent Tools

### Bearer token
The API bearer token (`AGENT_BEARER_TOKEN`) is in `.dev.vars`.
Include it in all `/api/*` requests:
```
Authorization: Bearer <AGENT_BEARER_TOKEN>
```
When calling the production API (`wizhard.store`) from outside the browser, also include the Cloudflare Access service token headers (also in `.dev.vars`):
```
CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>
```

### Competitor price check
To find the best live competitor price for a product and update Wizhard:
1. Load the `competitor-price-check` skill (in `skills/competitor-price-check/SKILL.md`)
2. Run it with the target SKU — it searches Amazon (8 EU domains), Worten, ECI, Boulanger, Darty, JoyBuy, FNAC, PC Componentes, MediaMarkt
3. PATCH the result: `{"fields":{"competitorPrice":X,"competitorUrl":"...","competitorPriceType":"normal"|"promo"},"triggeredBy":"agent"}`

Note: `data:[]` on a successful PATCH is normal (no platform sync triggered). Verify by re-fetching.

---

## 14) Session Shortcut Rule

If user says `Test restart`, execute in this exact order:
1. close all local test server instances
2. close all local browser-runner instances
3. close all PowerShell windows
4. clear local product data only (keep config/reference tables)
5. restart local test server
6. restart local browser runner
7. sync Ireland warehouse only

Runner preference:
- run runner in visible terminal
- headed browser mode (not headless)

## 15) Deferred Decisions

- Wrangler v4 upgrade: deferred
- `/api/cron` scheduled-only hardening: deferred

## 16) Open TODO (Google Ads Attribution rollout)

Docs:
- `docs/google-ads/README.md`
- `docs/google-ads/campaign-pipeline.md`
- `docs/google-ads/campaign-setup-rules.md`
- `docs/google-ads/testing-and-sandbox.md`
- `docs/google-ads/performance-analysis.md`
- `docs/google-ads/attribution.md`
- `docs/google-ads/technical-integration.md`
- `docs/google-ads/runbooks.md`
- `docs/google-ads/campaign-templates.md`
- `docs/google-ads/test-campaigns.md`

Rules:
- Do not enable `GOOGLE_ADS_PUBLISH_ENABLED=1` until Google Ads import works.
- Wizhard-created Google Ads campaigns must be created paused first.
- Campaigns must have a verified destination URL before scheduling.
- Test/manual Google Ads campaigns must be documented in `docs/google-ads/test-campaigns.md`.
- Google-reported conversions and Wizhard-attributed orders must be labeled separately in analysis.

1. Set production vars:
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_CUSTOMER_ID`
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (if manager account)
   - `ADS_AGENT_BEARER_TOKEN`
2. Deploy latest `master` so endpoints are live:
   - `POST /api/google-ads/import`
   - `GET /api/marketing/consolidated`
3. Run import sequence:
   - `POST /api/google-ads/import`
   - `POST /api/sales/import`
4. Validate attribution output in `sales_marketing_consolidated`
5. Optional hardening: restrict `/api/marketing/consolidated` to `ADS_AGENT_BEARER_TOKEN` only
