# Spec — `/channels/[id]`

**Status:** `implemented-ready`
**Frame:** `RetFc` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/channels/[id]/page.tsx`

---

## Purpose

Per-channel product table. Shows every product mapped to this channel with its current sync status, last push result, and price. Allows filtering by push status.

---

## URL Parameters

- `[id]` = platform ID (e.g., `woocommerce`, `shopify_komputerzz`, `xmr_bazaar`)

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Channel metadata | `salesChannels` table | `GET /api/channels/:id` |
| Product list with push status | `products` + `platformMappings` | `GET /api/channels/:id?page=&perPage=&status=` |
| Per-product sync status | `platformMappings.syncStatus` | same |
| Per-product price | `productPrices.price` | same |

### Query Parameters

- `status`: `in_stock` | `disabled` | `out_of_stock` (maps to `products.status` + `platformMappings.syncStatus`)
- `page`, `perPage`

---

## Page Header

- Breadcrumb: Sale Channels → [Channel Label]
- Channel connector type badge
- **Browser runner channels:** amber banner: "This channel is managed by the local Playwright runner. Push queue is visible here but execution is local-only."
- Last health check result + timestamp

---

## Product Table Columns

| Column | Field | Notes |
|---|---|---|
| SKU | `products.id` | Link to `/products/[sku]` |
| Title | `products.title` | — |
| Status | `products.status` | `active` / `archived` |
| Platform status | `platformMappings.syncStatus` | `synced` / `differences` / `missing` / `error` / `pending` |
| Last synced | `platformMappings.lastSynced` | Relative time or `—` |
| Price | `productPrices.price` | In EUR, formatted |
| Platform ID | `platformMappings.platformId` | External ID on the channel |
| Push status | `products.pushed_*` | `N` / `2push` / `done` |

### Status Badges

| Value | Badge |
|---|---|
| `synced` | Green |
| `differences` | Amber |
| `missing` | Gray |
| `error` | Red |
| `pending` | Blue |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Table skeleton |
| `empty` | No products mapped | "No products mapped to this channel." |
| `error` | Fetch fails | Error banner with retry |
| `success` | Data loaded | Full product table with pagination |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Filter by status | URL query `?status=` | Client-side filter chips |
| View product detail | Link to `/products/[sku]` | — |
| Trigger channel sync (API channels only) | `POST /api/sync/channel-availability` | Not available for browser channels |

---

## Edge / Error States

- **Unknown channel ID:** redirect to `/channels` with toast "Channel not found."
- **Browser runner channel:** "Trigger sync" button hidden; replaced with link to runner docs.
- **Empty platform ID:** show `—` in Platform ID column and badge: `Missing mapping`.

---

## Accessibility Notes

- Table has `<caption>` = "[Channel Label] — product table"
- Sortable columns use `aria-sort`
- Status badges have `aria-label`
