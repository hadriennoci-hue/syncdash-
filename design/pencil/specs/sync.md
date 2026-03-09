# Spec - Sync (/sync)

## Route
`/sync`

## Purpose
Read and monitor synchronization operations and logs.

## Primary blocks
1. **Sync overview**
2. **Recent run status**
3. **Navigation to detailed logs (`/sync/logs`)**

## Data displayed (field names)
| Field | Source |
|---|---|
| daily sync execution status | `daily_sync_log` |
| operational action logs | `sync_log` |

## User actions
- Navigate to `/sync/logs`
- Trigger operational sync from dashboard workflows:
  - warehouse scan stream: `GET /api/warehouses/sync-all/stream`
  - channel push: `POST /api/sync/channel-availability`

## State behavior
- Loading: status placeholders
- Empty: no sync history
- Error: failure banner + retry
- Success: latest status + history

## Responsive notes
- Stacked content on mobile

## Accessibility notes
- Status text always present with color cues as secondary signal
