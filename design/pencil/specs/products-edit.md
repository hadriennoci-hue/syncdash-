# Spec — `/products/[sku]/edit`

**Status:** `implemented-ready`
**Frame:** *(to be added — missing from pencil-new.pen)*
**Route file:** `src/app/(dashboard)/products/[sku]/edit/page.tsx`

---

## Purpose

Edit form for an existing product. Pre-populated with current values. On submit, patches changed fields to `PATCH /api/products/:sku`. Does not auto-push — push must be explicitly triggered.

---

## URL Parameters

- `[sku]` = product SKU

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Current product values | `products` + related | `GET /api/products/:sku` |
| Supplier list | `suppliers` table | `GET /api/suppliers` |
| Category list | `categories` table | `GET /api/categories` |

---

## Form Sections

### 1. Core Fields (pre-filled)

| Field | Type | Required |
|---|---|---|
| Title | text | ✅ |
| Description | textarea | — |
| Vendor | text | — |
| Product type | text | — |
| Tax code | text | — |
| EAN | text | — |
| Commodity code | text | — |
| Customs description | text | — |
| Country of manufacture | text | — |
| Weight | number (kg) | — |
| Status | select: active/archived | — |
| Is featured | checkbox | — |
| Supplier | dropdown | — |

> SKU is read-only (cannot be changed after creation).

### 2. Platform selection

Checkboxes for which platforms to push the update to:
- woocommerce
- shopify_komputerzz
- shopify_tiktok
- ebay_ie

Browser channels (xmr_bazaar, libre_market) have separate push flow — not shown here.

### 3. Categories

Multi-select (same as new product form).

---

## Form Submission

`PATCH /api/products/:sku` with:
```json
{
  "fields": { "title": "...", "description": "...", ... },
  "platforms": ["woocommerce", "shopify_komputerzz"],
  "triggeredBy": "human"
}
```

On success → redirect to `/products/[sku]` with toast "Product updated."

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Loading product + dependencies | Skeleton form |
| `not-found` | Unknown SKU | "Product not found." |
| `submitting` | Form submitted | Spinner, form disabled |
| `error` | API error | Toast + field errors |
| `success` | Saved | Redirect to detail page |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Save changes | `PATCH /api/products/:sku` | `triggeredBy: 'human'` |
| Cancel | navigate to `/products/[sku]` | Discard changes |

---

## Edge / Error States

- **Validation error:** Zod error surfaced per-field.
- **Platform sync error:** partial success — main record saved, platform push failed → show per-platform error in toast.

---

## Accessibility Notes

- SKU field is `readonly` with `aria-readonly="true"`
- All inputs have `<label>`
- Form has `<fieldset>` groups with `<legend>`
