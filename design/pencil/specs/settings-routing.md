# Spec — `/settings/routing`

**Status:** `implemented-ready`
**Frame:** *(to be added — missing from pencil-new.pen)*
**Route file:** `src/app/(dashboard)/settings/routing/page.tsx`

---

## Purpose

Warehouse-to-channel routing rules configuration. Controls which warehouse feeds stock to which sale channel and at what priority. These rules drive the daily channel-availability sync.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Current rules matrix | `warehouseChannelRules` table | `GET /api/warehouses/rules` |
| Warehouse list | `warehouses` table | embedded in rules response |
| Channel list | `salesChannels` table | embedded |

### Rule Schema

```json
{
  "warehouseId": "ireland",
  "platform": "woocommerce",
  "priority": 1
}
```

---

## Page Layout

### Rules Matrix

A grid: rows = warehouses, columns = channels.

Channels (columns):
- COINCART.STORE (woocommerce)
- KOMPUTERZZ.COM (shopify_komputerzz)
- Tech Store / TikTok (shopify_tiktok)
- eBay.ie (ebay_ie)
- XMR Bazaar (xmr_bazaar) — browser runner note
- Libre Market (libre_market) — browser runner note

Warehouses (rows):
- Ireland (read-only)
- Poland (read-only)
- ACER Store (writable)

Each cell: priority number input (1 = highest priority; blank = not connected).

### Priority Logic Note

Shown as a callout box:
> "When a product has stock in multiple warehouses, the warehouse with the lowest priority number feeds the channel first. Set to blank to disconnect a warehouse from a channel."

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton matrix |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Editable matrix |
| `saving` | PUT in progress | Cells show spinner, Save button disabled |
| `saved` | PUT success | Toast "Routing rules saved." |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Edit priority | client-side (number input) | — |
| Save all changes | `PUT /api/warehouses/rules` with `{ rules[] }` | Saves whole matrix at once |
| Reset to defaults | client-side | Restore last saved values |

---

## Edge / Error States

- **Invalid priority (non-integer or < 1):** inline validation: "Priority must be a positive integer."
- **Save conflict:** show "Rules were updated by another session. Reload and try again."
- **Browser runner channels:** cells for xmr_bazaar and libre_market are display-only with note "Browser runner — routing managed by local script."

---

## Accessibility Notes

- Matrix has `<table>` with `<thead>` for channels and `<th scope="row">` for warehouses
- Priority inputs have `aria-label` = "[Warehouse] → [Channel] priority"
- Save button has `aria-busy` during save
