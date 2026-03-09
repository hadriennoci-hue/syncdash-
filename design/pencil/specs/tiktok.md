# Spec — `/tiktok`

**Status:** `implemented-ready`
**Frame:** `uFLuV` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/tiktok/page.tsx`

---

## Purpose

TikTok Shop SKU whitelist manager. Controls which products are eligible for the `shopify_tiktok` sales channel. Products must be explicitly added here before they appear in TikTok Shop push workflows.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Selected SKUs | `tiktokSelection` table | `GET /api/tiktok/selection` |
| Product details (title, status) | `products` via join | same |
| Available products (for adding) | `products` table | `GET /api/products?search=` |

---

## Page Layout

### Selected Products Table

Products currently in the TikTok Shop selection:

| Column | Field | Notes |
|---|---|---|
| SKU | `tiktokSelection.productId` | Link to `/products/[sku]` |
| Title | `products.title` | — |
| Status | `products.status` | Active / Archived badge |
| TikTok push status | `products.pushedShopifyTiktok` | N / 2push / done |
| Added at | `tiktokSelection.addedAt` | Relative time |
| Action | Remove button | — |

### Add Product Panel

- Search input → `GET /api/products?search=` (debounced)
- Results list: SKU + title chips
- Click to add → `POST /api/tiktok/selection` with `{ sku }`

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton table |
| `empty-selection` | No SKUs selected | "No products in TikTok selection. Add products to get started." |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Table + add panel |
| `search-loading` | Typing in search | Spinner in dropdown |
| `search-empty` | No results | "No products found for '[query]'" |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Add product to selection | `POST /api/tiktok/selection` | Body: `{ sku }` |
| Remove product from selection | `DELETE /api/tiktok/selection/:sku` | Confirm before delete |
| View product detail | link to `/products/[sku]` | — |

---

## Edge / Error States

- **Already in selection:** `POST` returns `409` → show toast "Already in TikTok selection."
- **Archived product added:** amber warning "This product is archived — it won't be pushed until re-activated."
- **Product not found:** `404` → toast "Product not found."

---

## Responsive Behavior

- Desktop: two-column layout (selection table left, add panel right)
- Mobile: stacked (add panel above table)

---

## Accessibility Notes

- Search input has `role="combobox"` with `aria-expanded` and `aria-controls`
- Remove buttons have `aria-label="Remove [SKU] from TikTok selection"`
- Confirm dialog has `role="alertdialog"`
