# Spec — `/products/new`

**Status:** `implemented-ready`
**Frame:** `Q0G5O` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/products/new/page.tsx`

---

## Purpose

Create a new product from scratch. Sets core fields, initial prices per platform, assigns categories, and optionally assigns to a supplier. Does NOT auto-push on creation — push must be triggered separately.

---

## Data Bindings (form dependencies)

| Field | Source | Endpoint |
|---|---|---|
| Supplier list | `suppliers` table | `GET /api/suppliers` |
| Category list | `categories` table | `GET /api/categories` |
| Platform list | from `Platform` type | static |

---

## Form Sections

### 1. Core Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| SKU | text | ✅ | Must be unique; validated on submit |
| Title | text | ✅ | — |
| Description | textarea | — | HTML allowed |
| Vendor | text | — | — |
| Product type | text | — | — |
| Tax code | text | — | — |
| EAN | text | — | — |
| Status | select | — | `active` (default) / `archived` |
| Is featured | checkbox | — | Default: unchecked |
| Supplier | dropdown | — | From supplier list |
| Weight | number | — | In kg |

### 2. Prices per Platform

One price row per active platform (woocommerce, shopify_komputerzz, shopify_tiktok, ebay_ie):

| Field | Type |
|---|---|
| Price (EUR) | number |
| Compare-at price | number (optional) |

Browser channels (xmr_bazaar, libre_market) — no price fields.

### 3. Categories

Multi-select from available categories. Grouped by platform (Shopify collections vs WooCommerce categories).

### 4. Platform Selection

Checkboxes: which platforms to sync this product to immediately after creation.

---

## Form Submission

`POST /api/products` with body matching the full product creation schema including `triggeredBy: 'human'`.

On success → redirect to `/products/[sku]` with success toast.
On SKU conflict → inline error on SKU field: "This SKU already exists."

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Loading categories/suppliers | Skeleton dropdowns |
| `submitting` | Form submitted | Submit button spinner, all fields disabled |
| `error` | API error | Toast + field errors |
| `success` | Product created | Redirect to product detail |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Submit | `POST /api/products` | `triggeredBy: 'human'` |
| Cancel | navigate to `/warehouses` | (products redirects there) |

---

## Edge / Error States

- **Duplicate SKU:** `409 CONFLICT` → "SKU already in use."
- **Missing required field:** Zod validation error surfaced inline.

---

## Accessibility Notes

- Form sections use `<fieldset>` + `<legend>`
- All inputs have explicit `<label>`
- Error messages use `role="alert"` and `aria-describedby`
