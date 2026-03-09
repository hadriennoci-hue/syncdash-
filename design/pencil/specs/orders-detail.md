# Spec — `/orders/[id]`

**Status:** `implemented-ready`
**Frame:** `Z31uU` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/orders/[id]/page.tsx`

---

## Purpose

Purchase order detail view. Shows header info (supplier, warehouse, dates), line items with received quantity, and allows status updates (paid, sent, arrival).

---

## URL Parameters

- `[id]` = order ID (internal UUID)

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Order header | `orders` table | `GET /api/orders/:id` |
| Supplier | `suppliers` via join | same |
| Warehouse | `warehouses` via join | same |
| Line items | `orderItems` via join | same |
| Product names/SKUs | `products` via join | same |

---

## Page Sections

### Order Header Card

| Field | Display |
|---|---|
| Invoice # | Large text, prominent |
| Supplier | Link to `/suppliers/[id]` |
| Warehouse | Link to `/warehouses/[id]` |
| Order date | Formatted |
| Created at | Relative timestamp |

### Status Section

Inline toggles (editable):

| Field | Control | Values |
|---|---|---|
| Paid | Toggle / badge | Paid / Unpaid |
| Sent to supplier | Toggle / badge | Sent / Pending |
| Arrival status | Dropdown | pending / partial / arrived / cancelled |

Saves on change → `PATCH /api/orders/:id`

### Line Items Table

| Column | Field | Notes |
|---|---|---|
| SKU | `orderItems.productId` | Link to `/products/[sku]` |
| Product title | `products.title` | — |
| Ordered qty | `orderItems.quantity` | Read-only |
| Received qty | `orderItems.quantityReceived` | Editable inline |
| Unit price | `orderItems.purchasePrice` | In EUR |
| Line total | qty × price | Derived |

Footer: Total ordered value (sum of all line totals).

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton header + table |
| `not-found` | Unknown ID | "Order not found." + back link |
| `error` | Fetch fails | Error banner with retry |
| `success` | Data loaded | Full order detail |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Update paid status | `PATCH /api/orders/:id` | `{ paid: true/false }` |
| Update sent status | `PATCH /api/orders/:id` | `{ sentToSupplier: true/false }` |
| Update arrival status | `PATCH /api/orders/:id` | `{ arrivalStatus: '...' }` |
| Update received qty | `PATCH /api/orders/:id` | `{ items: [...] }` |

---

## Edge / Error States

- **Arrived order:** once `arrivalStatus = arrived`, received quantities are locked to their final value (still display but not editable).
- **Cancelled order:** all status toggles become read-only with a "Cancelled" banner.

---

## Accessibility Notes

- Status toggles have `aria-pressed` states
- Editable cells have `role="gridcell"` + `aria-readonly` set appropriately
