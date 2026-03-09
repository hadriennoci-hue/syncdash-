# Spec — `/suppliers/[id]`

**Status:** `implemented-ready`
**Frame:** `W8ccv` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/suppliers/[id]/page.tsx`

---

## Purpose

Supplier profile page. Shows contact details, linked products, and order history for a single supplier.

---

## URL Parameters

- `[id]` = supplier ID (internal UUID)

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Supplier info | `suppliers` table | `GET /api/suppliers/:id` |
| Order history | `orders` table where `supplierId = id` | same (joined) |
| Order items | `orderItems` via join | same |
| Product names | `products` via join | same |

---

## Page Sections

### Contact Card

| Field | Display |
|---|---|
| Supplier name | Large heading |
| Contact name | First + Last or `—` |
| Email | Mailto link or `—` |
| Created at | Relative timestamp |

Inline edit: click field to edit → `PATCH /api/suppliers/:id`

### Orders Section

Recent orders table:

| Column | Field |
|---|---|
| Invoice # | Link to `/orders/[id]` |
| Warehouse | Link to `/warehouses/[id]` |
| Date | Formatted |
| Total value | Sum of item totals |
| Arrival status | Badge |

### Products Section

Products ever ordered from this supplier (via `orderItems → orders → products`):

| Column | Field |
|---|---|
| SKU | Link to `/products/[sku]` |
| Title | — |
| Times ordered | Count |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton layout |
| `not-found` | Unknown ID | "Supplier not found." + back link |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Full profile |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Edit contact info | `PATCH /api/suppliers/:id` | Inline edit |
| Create order for supplier | navigate to `/orders/new?supplierId=` | Pre-fill supplier |

---

## Accessibility Notes

- Editable fields use `contenteditable` with `role="textbox"` or inline `<input>`
- Section headings use `<h2>` / `<h3>` hierarchy
