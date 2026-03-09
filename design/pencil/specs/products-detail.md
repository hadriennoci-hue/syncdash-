# Spec — `/products/[sku]`

**Status:** `implemented-ready`
**Frame:** `HwgGJ` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/products/[sku]/page.tsx`

---

## Purpose

Full product detail view. Shows all fields, per-platform sync status, images, prices, stock across warehouses, category assignments, sync log, and provides action triggers for push/image/price operations.

---

## URL Parameters

- `[sku]` = product SKU (primary key in `products` table)

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Product detail | `products` + all related tables | `GET /api/products/:sku` |
| Platform mappings | `platformMappings` | same (with: platformMappings) |
| Images | `productImages` | same (with: images) |
| Prices | `productPrices` | same (with: prices) |
| Variants | `productVariants` | same (with: variants) |
| Categories | `productCategories` + `categories` | same (with: metafields) |
| Warehouse stock | `warehouseStock` | same |
| Sync log | `syncLog` where productId = sku | `GET /api/sync/logs?productId=` |

---

## Page Sections

### 1. Header

- SKU (monospace, large)
- Title
- Status badge (active=green / archived=gray)
- `pendingReview` amber banner if `= 1`: "This product was auto-created and awaits manual review."
- Edit button → `/products/[sku]/edit`

### 2. Platform Status Row

One status chip per platform:

| Platform | Shows |
|---|---|
| woocommerce | Push status (`N` / `2push` / `done`) + sync status |
| shopify_komputerzz | same |
| shopify_tiktok | same |
| ebay_ie | same |
| xmr_bazaar | Push status + "Browser runner" badge |
| libre_market | Push status + "Browser runner" badge |

Push status values:
- `N` → gray "Not pushed"
- `2push` → amber "Queued"
- `done` → green "Live"

### 3. Images

Image grid. Per image: thumbnail, position, alt text. Actions:
- Upload image → `POST /api/products/:sku/images/upload`
- Fetch from URL → `POST /api/products/:sku/images/fetch`
- Copy from platform → `POST /api/products/:sku/images/copy`
- Delete image → `DELETE /api/products/:sku/images/:imageId`

### 4. Prices

Table: one row per platform with `price` and `compareAt` fields. Editable inline.
Save → `PATCH /api/products/:sku/prices`

Browser channels: no price rows.

### 5. Warehouse Stock

Table: one row per warehouse with quantity, ordered qty, last order date.
ACER Store rows are editable → `PATCH /api/warehouses/:id/stock`

### 6. Categories

Current category assignments. Edit → modal to add/remove → `PUT /api/products/:sku/categories`

### 7. Sync Log

Last 20 entries from `syncLog` for this product. Columns: action, platform, status, triggered_by, created_at.

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton layout with all sections |
| `not-found` | Unknown SKU | "Product not found." + back link |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Full detail |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Edit product | navigate to `/products/[sku]/edit` | — |
| Update push status | `PATCH /api/products/:sku/push-status` | Per platform, set `N`/`2push`/`done` |
| Update prices | `PATCH /api/products/:sku/prices` | — |
| Update status (active/archived) | `PATCH /api/products/:sku/status` | — |
| Upload image | `POST /api/products/:sku/images/upload` | multipart |
| Fetch image from URL | `POST /api/products/:sku/images/fetch` | `{ url }` |
| Delete image | `DELETE /api/products/:sku/images/:imageId` | — |
| Copy images from platform | `POST /api/products/:sku/images/copy` | — |
| Pull from channel | `POST /api/products/:sku/pull-from-channel` | Merge from platform |
| Fill missing fields | `POST /api/products/:sku/fill-missing` | — |
| Dismiss pendingReview | `PATCH /api/products/:sku` with `{ fields: { pendingReview: 0 } }` | — |

---

## Edge / Error States

- **pendingReview = 1:** amber banner at top; "Mark as reviewed" button.
- **Platform missing mapping:** platform chip shows "Not mapped" — no platformId.
- **No images:** image section shows empty state "No images yet."
- **No warehouse stock:** shows "—" in all stock columns.

---

## Accessibility Notes

- Section headings use `<h2>` / `<h3>` hierarchy
- Platform status chips have `aria-label` including platform name and status
- Image grid items have `aria-label` = "Image [N]: [alt text]"
