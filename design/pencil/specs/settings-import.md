# Spec — `/settings/import`

**Status:** `implemented-ready`
**Frame:** *(to be added — missing from pencil-new.pen)*
**Route file:** `src/app/(dashboard)/settings/import/page.tsx`

---

## Purpose

Platform import interface. Allows triggering an import from any API-connected platform to resync products from the remote source into D1. Supports two modes: `new_changed` (safe, additive) and `full` (destructive, replace all).

---

## Import Modes

| Mode | Behaviour |
|---|---|
| `new_changed` | Default. Upserts only — creates new SKUs, updates changed ones. Does not delete. |
| `full` | Full re-import. Replaces all data for every product from the platform. ⚠️ Destructive. |

---

## Supported Platforms (for import)

| Platform | Connector | Notes |
|---|---|---|
| `shopify_komputerzz` | ShopifyConnector | Primary import source (Komputerzz was initial master) |
| `woocommerce` | WooCommerceConnector | Secondary |
| `shopify_tiktok` | ShopifyConnector | — |
| `ebay_ie` | EbayConnector | — |

> `xmr_bazaar` and `libre_market` are browser-runner — no import capability.

---

## Page Layout

### Import Card per Platform

Each card:
- Platform label + logo
- Mode selector: `new_changed` (default) | `full` (with ⚠️ destructive warning)
- "Run Import" button
- Last import result (if available): count of imported/updated/skipped/errors

### Import Result (inline, after trigger)

```
✓ Import complete
Imported: 45
Updated: 12
Skipped: 3
Errors: 0
```

Error list if `errors.length > 0`: expandable list of SKU + error message.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Last import results | `syncLog` for `action = 'import'` | `GET /api/sync/logs?action=import&platform=` |
| Import trigger | — | `POST /api/import/:platform` |

---

## Form / Request

`POST /api/import/:platform` with body:
```json
{
  "mode": "new_changed",
  "triggeredBy": "human"
}
```

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `idle` | Page load | Platform cards with last import info |
| `importing` | After "Run Import" click | Button disabled, spinner, "Importing…" |
| `success` | Import complete | Inline result block (green) |
| `error` | Import failed | Inline error block (red) with message |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Trigger import | `POST /api/import/:platform` | Per-platform, per-mode |
| View sync logs | navigate to `/sync/logs?action=import` | Link below each card |

---

## Edge / Error States

- **`full` mode confirmation:** clicking "Run Import (Full)" opens a confirmation modal: "This will replace all product data from [Platform]. This cannot be undone. Continue?"
- **Platform unreachable:** connector health check fails → show: "Platform unavailable. Check health status."
- **Rate limited:** show: "Import rate-limited. Try again in [N] seconds."

---

## Auth Notes

- Import endpoints use standard `AGENT_BEARER_TOKEN` — same as all other `/api/*` routes.
- `/api/cron` is internal/scheduled only — not exposed here.

---

## Accessibility Notes

- Confirmation modal has `role="alertdialog"` with `aria-describedby`
- Mode selector uses `<input type="radio">` with labels
- Progress states use `role="status"` live region
