# Spec — `/orders/new`

**Status:** `implemented-ready`
**Frame:** *(to be added — missing from pencil-new.pen)*
**Route file:** `src/app/(dashboard)/orders/new/page.tsx`

---

## Purpose

Create a new purchase order. Selects supplier, destination warehouse, order date, and line items (product + quantity + purchase price). Submits to `POST /api/orders`.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Supplier list | `suppliers` table | `GET /api/suppliers` |
| Warehouse list | `warehouses` table | `GET /api/warehouses` |
| Product search | `products` table | `GET /api/products?search=` |

---

## Form Fields

### Order Header

| Field | Type | Required | Notes |
|---|---|---|---|
| Invoice number | text input | ✅ | Must be unique — validated on submit |
| Supplier | dropdown | ✅ | All suppliers |
| Warehouse | dropdown | ✅ | ireland, poland, acer_store |
| Order date | date picker | ✅ | Defaults to today |
| Paid | checkbox | — | Default: unchecked |
| Sent to supplier | checkbox | — | Default: unchecked |

### Line Items

Repeatable row:

| Field | Type | Required | Notes |
|---|---|---|---|
| Product | search/select | ✅ | Search by SKU or title |
| Quantity | number | ✅ | Min 1 |
| Purchase price | number (EUR) | ✅ | Per unit |

Actions per row:
- `+` Add item
- `✕` Remove item

Order total shown below: Σ (quantity × price) per item.

---

## Form Submission

`POST /api/orders` with body:
```json
{
  "invoiceNumber": "INV-2026-001",
  "supplierId": "...",
  "warehouseId": "acer_store",
  "orderDate": "2026-03-09",
  "paid": false,
  "sentToSupplier": false,
  "items": [
    { "productId": "SKU-001", "quantity": 10, "purchasePrice": 49.99 }
  ]
}
```

On success → redirect to `/orders/[newId]` with success toast.
On conflict (duplicate invoice number) → inline error on invoice field.

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Loading supplier/warehouse lists | Skeleton dropdowns |
| `empty-products` | Product search yields no results | "No products found for '[query]'" in dropdown |
| `submitting` | Form submitted | Submit button shows spinner, disabled |
| `error` | API returns error | Toast + inline field errors if applicable |
| `success` | Order created | Redirect to new order detail |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Submit form | `POST /api/orders` | `triggeredBy: 'human'` |
| Cancel | navigate to `/orders` | Discard form |
| Add line item | client-side | Append new row |
| Remove line item | client-side | Remove row (min 1 item required) |

---

## Edge / Error States

- **Duplicate invoice number:** `409 CONFLICT` — show: "Invoice number already exists."
- **Supplier not found:** dropdown handles empty gracefully with "No suppliers yet — create one first."
- **No products exist:** product search shows "No products in catalogue."

---

## Accessibility Notes

- Line items use `fieldset` + `legend` = "Line items"
- Each row has `aria-label` = "Line item [N]"
- Required fields marked with `aria-required="true"`
- Error messages linked via `aria-describedby`
