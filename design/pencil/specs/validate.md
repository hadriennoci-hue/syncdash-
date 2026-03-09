# Spec — `/validate`

**Status:** `implemented-ready`
**Frame:** `8XzWs` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/validate/page.tsx`

---

## Purpose

WooCommerce push readiness checker. Validates that all products intended for WooCommerce have the required category mappings before pushing. Shows blockers and a pass/fail summary.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Readiness report | `products` + `categoryMappings` + `categories` | `GET /api/validate/woocommerce-readiness` |

### Response Shape

```json
{
  "ready": false,
  "blockers": ["SKU-001: Missing WooCommerce category mapping for collection 'Electronics'"],
  "productsBlocked": 12,
  "collectionsUnmapped": 3,
  "productsReady": 45
}
```

---

## Page Layout

### Summary Card

| Field | Display |
|---|---|
| Overall status | Large badge: "Ready ✓" (green) or "Blockers found" (red) |
| Products ready | Count (green) |
| Products blocked | Count (red) |
| Unmapped collections | Count (amber) |

### Blockers List

If `ready = false`:

Table of blockers:

| Column | Notes |
|---|---|
| SKU | Link to `/products/[sku]` |
| Blocker description | Human-readable text from `blockers[]` |
| Fix action | "Go to mappings →" link to `/mappings` |

### Collections Unmapped

Below blockers: list of Shopify collections that have no WooCommerce category mapping.
CTA: "Configure mappings →" link to `/mappings`.

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Running validation | Spinner + "Running readiness check…" |
| `ready` | `ready = true`, 0 blockers | Green summary + "All products ready for WooCommerce push." |
| `has-blockers` | `ready = false` | Red summary + blockers table |
| `error` | Fetch fails | Error banner with retry |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Re-run validation | `GET /api/validate/woocommerce-readiness` | Refresh button |
| Navigate to mappings | navigate to `/mappings` | Fix unmapped collections |
| View product | navigate to `/products/[sku]` | Fix per-product issue |

---

## Edge / Error States

- **All products ready:** `ready = true` → no blockers table, just success state.
- **No products exist:** "No products in catalogue — nothing to validate."

---

## Accessibility Notes

- Status badge uses `role="status"` with descriptive `aria-label`
- Blockers table has `<caption>` = "Push blockers"
- "Go to mappings" links have descriptive `aria-label` including the collection name
