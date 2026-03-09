# Spec — `/analyze`

**Status:** `implemented-ready`
**Frame:** `tvtcW` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/analyze/page.tsx`

---

## Purpose

Cross-channel inconsistency detection. Lists products with data mismatches across platforms (missing images, title drift, price delta, category gaps, missing mappings). Enables targeted remediation.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Inconsistency list | `products` + `platformMappings` + `productImages` + `productPrices` | `GET /api/analyze?type=` |
| SKU-level detail | same | `GET /api/analyze/:sku` |

### Inconsistency Types

| `type` | Meaning |
|---|---|
| `missing_images` | Product has no images |
| `different_title` | Title in D1 ≠ title on one or more platforms |
| `different_description` | Description mismatch |
| `missing_categories` | No category assigned |
| `different_price` | Price in D1 ≠ price on one or more platforms |
| `missing_on_platform` | Product not mapped on an active platform |

---

## Page Layout

### Filter Bar

- Type filter: multi-select chips for inconsistency types
- Platform filter: dropdown (show only issues for a specific platform)
- Search: by SKU or title

### Inconsistency Table

| Column | Field | Notes |
|---|---|---|
| SKU | `products.id` | Link to `/products/[sku]` |
| Title | `products.title` | — |
| Issue type | `InconsistencyType` | Badge |
| Affected platforms | list of platform IDs | Platform chips |
| Detail | human-readable description | E.g. "Missing on shopify_komputerzz" |
| Action | CTA button | Context-dependent |

### Remediation Actions per Type

| Type | Action Button | Endpoint |
|---|---|---|
| `missing_images` | "Pull images from [platform]" | `POST /api/products/:sku/images/copy` |
| `missing_on_platform` | "Push to [platform]" | `PATCH /api/products/:sku/push-status` |
| `different_price` | "View product" | navigate to `/products/[sku]` |
| `different_title` | "Fill from [platform]" | `POST /api/products/:sku/fill-missing` |
| `missing_categories` | "Edit categories" | navigate to `/products/[sku]` |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton table |
| `empty` | No inconsistencies | "All products are consistent across platforms." ✓ |
| `error` | Fetch fails | Error banner |
| `success` | Issues found | Table with count summary banner |

### Summary Banner (success)

"Found [N] inconsistencies across [M] products."

Breakdown by type:
- Missing images: N
- Price mismatches: N
- Missing on platform: N
- Title drift: N

---

## Edge / Error States

- **Platform unreachable:** note that analysis runs on D1 data only — no live platform calls.
- **Browser channels:** `xmr_bazaar` and `libre_market` excluded from `missing_on_platform` check (browser-runner — no connector).

---

## Accessibility Notes

- Filter chips use `role="checkbox"` with `aria-checked`
- Table `<caption>` = "Product inconsistencies"
- Action buttons have `aria-label` including SKU and action name
