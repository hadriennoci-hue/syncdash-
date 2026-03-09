# Spec — `/products`

**Status:** `redirect-route`
**Frame:** `fl3E9` in `pencil-new.pen` (marked [TARGET] — not active UI)
**Route file:** `src/app/(dashboard)/products/page.tsx`

---

## ⚠️ Current Implementation

`/products` **redirects to `/warehouses`** in current code:

```typescript
// src/app/(dashboard)/products/page.tsx
import { redirect } from 'next/navigation'
export default function ProductsPage() { redirect('/warehouses') }
```

**There is no active products list UI at this route.** Products are managed via:
- `/warehouses` (stock and catalogue entry)
- `/products/new` (create)
- `/products/[sku]` (detail)
- `/products/[sku]/edit` (edit)

---

## [TARGET] Variant — Master Catalogue Table

The `fl3E9` frame in pencil-new.pen represents the **future target** — a full master catalogue table once the product list route is re-activated.

> **Do not implement the frame below as current behavior. Mark clearly as [TARGET].**

### Target Purpose

Master catalog table with cross-channel push state visibility. Would replace the redirect and expose all products with filter/search/push actions.

### Target Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Product list | `products` table | `GET /api/products?page=&perPage=&search=&pendingReview=&missingFields=&hasStock=&pushedPlatform=` |
| Push state per platform | `products.pushed_*` | same |
| Stock totals | `warehouseStock` aggregation | same |
| Prices | `productPrices.price` | same |

### Target Table Columns

| Column | Field | Notes |
|---|---|---|
| SKU | `products.id` | Link to `/products/[sku]` |
| Title | `products.title` | — |
| Status | `products.status` | Active / Archived badge |
| Pending review | `products.pendingReview` | Amber badge if 1 |
| Push: WooCommerce | `pushedWoocommerce` | N / 2push / done |
| Push: Komputerzz | `pushedShopifyKomputerzz` | N / 2push / done |
| Push: TikTok | `pushedShopifyTiktok` | N / 2push / done |
| Push: eBay | `pushedEbayIe` | N / 2push / done |
| Push: XMR | `pushedXmrBazaar` | N / 2push / done (browser runner) |
| Push: Libre | `pushedLibreMarket` | N / 2push / done (browser runner) |
| Stock total | sum across warehouses | — |

### Target UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Table skeleton |
| `empty` | No products | "No products in catalogue." + "Create product" CTA |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Full table with filters |

### Target Filters

- Search: SKU or title
- Status: active / archived / all
- Pending review: yes / no / all
- Platform push state: per-platform filter

### Target Actions

| Action | Endpoint |
|---|---|
| Create product | navigate to `/products/new` |
| View detail | navigate to `/products/[sku]` |
| Bulk push status update | `PATCH /api/products/:sku/push-status` |

---

## Accessibility Notes

- (Target) Table `<caption>` = "Product catalogue"
- SKU links keyboard-focusable
- Push status badges include text labels + `aria-label`
