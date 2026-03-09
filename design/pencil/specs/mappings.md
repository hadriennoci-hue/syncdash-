# Spec — `/mappings`

**Status:** `implemented-ready`
**Frame:** `dGvAl` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/mappings/page.tsx`

---

## Purpose

Category mapping editor. Maps Shopify collections (from komputerzz/tiktok) to WooCommerce categories. Required for WooCommerce push — products without a mapped collection are blocked from being pushed to WooCommerce.

> **Note:** `/mappings` is not in the sidebar navigation. It is an internal tool accessible via `/validate` CTA and direct URL. Consider adding to Settings sub-nav in a future iteration.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| All mappings | `categoryMappings` + `categories` | `GET /api/mappings` |
| Summary | `{ total, mapped, unmapped }` | same (meta) |
| Save mappings | `categoryMappings` | `PUT /api/mappings` |

### Response Shape (GET)

```json
{
  "data": [
    {
      "shopifyCollectionId": "cat-123",
      "shopifyCollectionName": "Electronics",
      "wooCategoryIds": ["woo-456", "woo-789"],
      "wooCategoryNames": ["Electronics", "Computers"]
    }
  ],
  "meta": { "total": 15, "mapped": 12, "unmapped": 3 }
}
```

---

## Page Layout

### Summary Bar

"[M] of [N] collections mapped — [U] unmapped"
Amber warning if `unmapped > 0`.

CTA: "Go to Validate" to see which products are blocked.

### Mapping Table

| Column | Notes |
|---|---|
| Shopify collection | Name + platform badge (komputerzz / tiktok) |
| WooCommerce categories | Multi-select — current mapped categories |
| Status | "Mapped" (green) / "Unmapped" (amber) |

### Edit Flow

Click a row → side panel or inline:
- Multi-select from all WooCommerce categories
- Save / Cancel

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton table |
| `empty` | No categories found | "No categories in catalogue." |
| `all-mapped` | `unmapped = 0` | Green summary "All collections mapped ✓" |
| `has-unmapped` | `unmapped > 0` | Amber warning banner |
| `error` | Fetch fails | Error banner |
| `saving` | PUT in progress | Spinner in save button |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Map collection to WooCommerce category | `PUT /api/mappings` | Saves all current mappings in one call |
| Remove a mapping | `PUT /api/mappings` with empty `wooCategoryIds` | — |
| Navigate to validate | link to `/validate` | — |

### Request Body

```json
{
  "mappings": [
    { "shopifyCollectionId": "cat-123", "wooCategoryIds": ["woo-456"] },
    { "shopifyCollectionId": "cat-124", "wooCategoryIds": [] }
  ]
}
```

---

## Edge / Error States

- **No WooCommerce categories:** "No WooCommerce categories found. Import from WooCommerce first (`POST /api/import/woocommerce`)."
- **Save error:** toast "Failed to save mappings. Please retry."

---

## Auth Notes

- Uses standard `AGENT_BEARER_TOKEN` (same as all `/api/*` routes).
- No special ads-read token required.

---

## Accessibility Notes

- Table `<caption>` = "Shopify ↔ WooCommerce category mappings"
- Multi-select comboboxes have `aria-multiselectable="true"`
- Status badges have `aria-label`

---

## Sidebar / Nav Note

`/mappings` is **not in the sidebar**. Access via:
1. `/validate` → "Configure mappings →" CTA
2. Direct URL

Future: add to `/settings` sub-section if scope grows.
