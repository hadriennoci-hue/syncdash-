# Spec — `/warehouses/[id]`

**Status:** `implemented-ready`
**Frame:** `AQmkR` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/warehouses/[id]/page.tsx`

---

## Purpose

Per-warehouse stock table. Shows every product stocked at this warehouse with quantity, purchase price, and reorder tracking. Supports manual stock override (ACER Store only) and sync trigger.

---

## URL Parameters

- `[id]` = warehouse ID (`ireland`, `poland`, `acer_store`)

---

## Warehouse Behavior Rules

| Warehouse | canModifyStock | Sync Source |
|---|---|---|
| `ireland` | ❌ Read-only | Shopify TikTok OAuth |
| `poland` | ❌ Read-only | API TBD |
| `acer_store` | ✅ Writable | Firecrawl web scraping |

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Warehouse metadata | `warehouses` table | `GET /api/warehouses/:id` |
| Stock list | `warehouseStock` table | `GET /api/warehouses/:id?page=&perPage=&search=` |
| Per-product quantity | `warehouseStock.quantity` | same |
| Purchase price | `warehouseStock.purchasePrice` | same |
| Import price | `warehouseStock.importPrice` | same |
| Quantity ordered | `warehouseStock.quantityOrdered` | same |
| Last order date | `warehouseStock.lastOrderDate` | same |
| Source URL | `warehouseStock.sourceUrl` | same (ACER only) |

---

## Page Header

- Breadcrumb: Warehouses → [Warehouse Name]
- Warehouse address (if set)
- Last synced timestamp + sync trigger button
- **Read-only banner** for `ireland` and `poland`: "This warehouse is read-only. Stock is updated automatically."
- **ACER Store:** "Manual overrides allowed." note

---

## Stock Table Columns

| Column | Field | Notes |
|---|---|---|
| SKU | `warehouseStock.productId` | Link to `/products/[sku]` |
| Title | `products.title` | — |
| Qty in stock | `warehouseStock.quantity` | — |
| Qty ordered | `warehouseStock.quantityOrdered` | Editable (all warehouses) |
| Last order date | `warehouseStock.lastOrderDate` | Editable (all warehouses) |
| Purchase price | `warehouseStock.purchasePrice` | Editable (ACER only) |
| Import price | `warehouseStock.importPrice` | Display only |
| Source | `warehouseStock.sourceName` | ACER only; link via `sourceUrl` |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Table skeleton |
| `empty` | No stock records | "No stock data for this warehouse." |
| `error` | Fetch fails | Error banner with retry |
| `success` | Data loaded | Full stock table |

---

## User Actions

| Action | Endpoint | Condition |
|---|---|---|
| Trigger sync | `POST /api/warehouses/:id/sync` | All warehouses |
| Edit stock quantity | `PATCH /api/warehouses/:id/stock` | ACER Store only |
| Edit quantity ordered | `PATCH /api/warehouses/:id/stock` | All warehouses |
| Edit last order date | `PATCH /api/warehouses/:id/stock` | All warehouses |
| Edit purchase price | `PATCH /api/warehouses/:id/stock` | ACER Store only |
| Search / filter | URL query `?search=` | — |

---

## Inline Edit Pattern (ACER only)

Click cell → inline input → confirm with Enter or blur → `PATCH /api/warehouses/:id/stock` with `{ productId, quantity, ... }`.
Read-only cells on non-writable warehouses show a lock icon on hover.

---

## Edge / Error States

- **403 on write to read-only warehouse:** show toast: "Stock updates are not allowed for this warehouse."
- **Sync error:** show error message in banner with last error from sync response.
- **Unknown warehouse ID:** redirect to `/warehouses` with toast "Warehouse not found."
- **Poland:** shows placeholder content: "Sync not yet configured. API connector TBD."

---

## Accessibility Notes

- Table has `<caption>` = "[Warehouse Name] — stock table"
- Editable cells have `role="gridcell"` with `aria-readonly="false"` (ACER) or `"true"` (others)
- Lock icon has `aria-label="Read-only — cannot modify stock for this warehouse"`
