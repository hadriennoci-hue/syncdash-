# Spec - Warehouses (/warehouses)

## Route
`/warehouses`

## Purpose
Operational warehouse overview and entry point for warehouse-level stock management.

## Primary blocks
1. **Warehouse list/cards**
2. **Stock summary by warehouse**
3. **Navigation to warehouse detail pages**

## Data displayed (field names)
| Field | Source |
|---|---|
| `warehouses[].id`, `warehouses[].label`, `warehouses[].refsInStock` | `GET /api/dashboard/summary` |
| Warehouse-level stock rows | `warehouse_stock` via warehouse pages/apis |

## User actions
- Open warehouse detail: `/warehouses/[id]`
- Trigger scan from dashboard workflow: `GET /api/warehouses/sync-all/stream`

## State behavior
- Loading: placeholder rows/cards
- Empty: no warehouses configured
- Error: load failure with retry
- Success: stock summaries visible

## Responsive notes
- Desktop: multi-column card/list layout
- Mobile: stacked warehouse blocks

## Accessibility notes
- Warehouse entries are links with visible labels
