# Spec — `/suppliers`

**Status:** `implemented-ready`
**Frame:** `T1wB4` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/suppliers/page.tsx`

---

## Purpose

Supplier list view. Lists all supplier companies with contact details, linked product count, and order history summary.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Supplier list | `suppliers` table | `GET /api/suppliers?page=&perPage=&search=` |
| Contact info | `suppliers.contactFirstName/Last/email` | same |
| Open orders count | `orders` where `arrivalStatus != 'arrived'` | same (joined) |
| Total orders count | `orders` count | same (joined) |

---

## Supplier Card / Table Columns

| Column | Field | Notes |
|---|---|---|
| Name | `suppliers.name` | Link to `/suppliers/[id]` |
| Contact | `firstName + lastName` | Or `—` if not set |
| Email | `suppliers.email` | Mailto link or `—` |
| Open orders | count | Amber badge if > 0 |
| Total orders | count | — |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton rows |
| `empty` | No suppliers | "No suppliers yet." + "Add supplier" CTA |
| `error` | Fetch fails | Error banner with retry |
| `success` | Data loaded | Supplier table/list |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Create supplier | `POST /api/suppliers` | Modal/inline form in page header |
| View supplier detail | link to `/suppliers/[id]` | — |
| Search | URL `?search=` | By name |

### Create Supplier Form

Fields: `name` (required), `contactFirstName`, `contactLastName`, `email`

---

## Accessibility Notes

- Email links use `aria-label="Email [supplier name]"`
- Table `<caption>` = "Suppliers"
