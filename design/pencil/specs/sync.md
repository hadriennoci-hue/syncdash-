# Spec — `/sync`

**Status:** `implemented-ready`
**Frame:** `cOuXG` in `pencil-new.pen`
*(Frames `zyyXa` = `/sync/logs`, `3UFvD` = duplicate of `zyyXa` — discard `3UFvD`)*
**Route file:** `src/app/(dashboard)/sync/page.tsx`

---

## Purpose

Daily sync operations dashboard. Shows latest run status, history of past runs, a manual "Run now" trigger, and a link to detailed operation logs at `/sync/logs`.

> **Scope:** This is NOT a bulk action center or product push queue manager. It is specifically for daily warehouse + channel sync operations.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Daily sync history | `dailySyncLog` table | `GET /api/sync/logs?action=daily_sync&perPage=10` |
| Latest sync status | `dailySyncLog` most recent entry | same |
| Manual run trigger | — | `POST /api/sync/daily` |
| Channel availability trigger | — | `POST /api/sync/channel-availability` |

### `dailySyncLog` Fields Displayed

| Field | Display |
|---|---|
| `syncedAt` | Timestamp, relative |
| `status` | success / failure badge |
| `warehousesSynced` | JSON → count of warehouses synced |
| `channelsPushed` | JSON → count of channels pushed |
| `ordersReconciled` | integer count |
| `message` | Error message if status = failure |

---

## Page Sections

### 1. Latest Run Card

Shows last sync entry as a summary card:
- Status badge (green "Success" / red "Failed")
- Run time: absolute + relative
- Warehouses synced: N
- Channels pushed: N
- Orders reconciled: N
- Message (if failure): red text

### 2. Manual Run Buttons

| Button | Endpoint | Notes |
|---|---|---|
| "Run daily sync now" | `POST /api/sync/daily` | Full daily automation (warehouses + channels + reconciliation) |
| "Push channel availability" | `POST /api/sync/channel-availability` | Channel-only partial sync |

Both buttons:
- Show spinner while running
- Disable during run
- Show result inline on complete

> **Auth note:** These use standard `AGENT_BEARER_TOKEN`. The cron route `/api/cron` is Cloudflare-internal only and is NOT exposed here.

### 3. Run History Table

Last 10 daily sync entries:

| Column | Field |
|---|---|
| Date | `syncedAt` |
| Status | badge |
| Warehouses | `warehousesSynced` count |
| Channels | `channelsPushed` count |
| Orders | `ordersReconciled` |
| Duration | — (not stored; show `—`) |

Pagination: load older entries via link.

### 4. Link to Logs

Prominent link: "View detailed operation logs →" → `/sync/logs`

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton cards |
| `empty` | No sync history | "No sync runs recorded yet." + manual run buttons still shown |
| `error` | Fetch fails | Error banner |
| `success` | Data loaded | Full layout |
| `running` | After manual trigger | Spinner + "Running sync…" |
| `run-complete` | After sync finishes | Toast + refresh history |

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| Run full daily sync | `POST /api/sync/daily` | — |
| Run channel availability only | `POST /api/sync/channel-availability` | — |
| View detailed logs | navigate to `/sync/logs` | — |

---

## Edge / Error States

- **Sync already running:** if triggered while running, show "Sync is already in progress."
- **Partial failure:** status = failed but some warehouses/channels completed → message shows which failed.

---

## Accessibility Notes

- Run buttons have `aria-busy="true"` while running
- Status badges have `aria-label` with full text ("Last sync succeeded" / "Last sync failed")
- History table `<caption>` = "Daily sync history"
