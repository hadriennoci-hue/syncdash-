# Spec — `/orders`

**Status:** `implemented-ready`
**Frame:** `Jq86w` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/orders/page.tsx`

---

## Purpose

Purchase order list. Lists supplier orders with invoice number, supplier, destination warehouse, paid/sent/arrival status, and order date. Entry point to order detail and new order creation.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Order list | `orders` table | `GET /api/orders?page=&perPage=&supplierId=&warehouseId=&paid=&arrivalStatus=` |
| Supplier name | `suppliers.name` via join | same |
| Warehouse name | `warehouses.displayName` via join | same |
| Item count | `orderItems` count | same |

---

## Filters

| Filter | Type | Values |
|---|---|---|
| Supplier | Dropdown | All suppliers from DB |
| Warehouse | Dropdown | ireland, poland, acer_store |
| Paid | Toggle | All / Paid / Unpaid |
| Arrival status | Dropdown | pending / arrived / partial / cancelled |

---

## Order Table Columns

| Column | Field | Notes |
|---|---|---|
| Invoice # | `orders.invoiceNumber` | Link to `/orders/[id]` |
| Supplier | `suppliers.name` | Link to `/suppliers/[id]` |
| Warehouse | `warehouses.displayName` | Link to `/warehouses/[id]` |
| Order date | `orders.orderDate` | Formatted date |
| Paid | `orders.paid` | Boolean badge: green "Paid" / gray "Unpaid" |
| Sent to supplier | `orders.sentToSupplier` | Boolean badge: blue "Sent" / gray "Pending" |
| Arrival | `orders.arrivalStatus` | Badge: pending(gray) / partial(amber) / arrived(green) / cancelled(red) |
| Items | `orderItems` count | "N items" |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Table skeleton (10 rows) |
| `empty` | No orders match filters | "No purchase orders found." with "Create order" CTA |
| `error` | Fetch fails | Error banner with retry |
| `success` | Data loaded | Full orders table with pagination |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Create new order | navigate to `/orders/new` | Button in page header |
| View order detail | link to `/orders/[id]` | Row click or invoice link |
| Filter orders | URL query params | Supplier, warehouse, paid, arrivalStatus |

---

## Edge / Error States

- **No suppliers exist:** "Create order" button still shown; form will surface the empty supplier dropdown error.
- **Fetch error:** show inline error with retry — do not empty the table if stale data is available.

---

## Accessibility Notes

- Table with `<caption>` = "Purchase orders"
- Status badges have `aria-label`
- Filter dropdowns have `<label>` associations
