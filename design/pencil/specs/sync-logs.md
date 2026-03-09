# Spec — `/sync/logs`

**Status:** `implemented-ready`
**Frame:** `zyyXa` in `pencil-new.pen`
*(Frame `3UFvD` is a duplicate — treat as discarded)*
**Route file:** `src/app/(dashboard)/sync/logs/page.tsx`

---

## Purpose

Filterable operation-level sync log. Shows every write/push/pull action taken by the system, with platform, action type, status, triggered-by, and linked product. Primary debugging tool for sync failures.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Log entries | `syncLog` table | `GET /api/sync/logs?page=&perPage=&platform=&action=&status=&triggeredBy=&productId=` |

### Columns from `syncLog`

| Column | DB field |
|---|---|
| Timestamp | `createdAt` |
| Product | `productId` → link to `/products/[sku]` |
| Platform | `platform` |
| Action | `action` |
| Status | `status` |
| Triggered by | `triggeredBy` |
| Message | `message` |

---

## Filters

| Filter | Type | Values |
|---|---|---|
| Platform | Dropdown | All 6 platforms + "all" |
| Action | Dropdown | sync, push, pull, update, delete, import, etc. |
| Status | Dropdown | success / failure / pending |
| Triggered by | Toggle | human / agent / system / all |
| Product ID | Text search | — |
| Date range | Date picker | — |

---

## Log Entry Row

| Column | Notes |
|---|---|
| Time | Relative + absolute on hover |
| Product SKU | Link to `/products/[sku]` or `—` if not product-scoped |
| Platform | Platform chip badge |
| Action | Monospace label |
| Status | Green "success" / Red "failure" / Gray "pending" |
| Triggered by | `human` / `agent` / `system` |
| Message | Truncated; expand on click |

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton rows |
| `empty` | No logs match filters | "No sync operations found." |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Log table with pagination |

---

## User Actions

| Action | Notes |
|---|---|
| Filter by platform/action/status | Updates URL params |
| Expand log message | Inline row expansion |
| Paginate | Standard pagination controls |
| Back to Sync | Link to `/sync` |

---

## Accessibility Notes

- Table `<caption>` = "Sync operation logs"
- Expandable rows use `aria-expanded`
- Filter dropdowns have `<label>` associations
