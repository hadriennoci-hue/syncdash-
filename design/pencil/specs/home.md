# Spec - Dashboard (/)

## Route
`/`

## Purpose
Central operational overview. Surfaces warehouse stock status, push queue, channel performance context, and supplier relation.

## Primary blocks
1. **Warehouses block** - warehouse nodes, scan button, last scan text
2. **Wizhard block** - non-active product count + push queue action
3. **Sale Channels block** - channel nodes with ad campaign count and 24h sales
4. **Suppliers link block** - last invoice date and supplier navigation

## Data displayed (field names)
| Field | Source |
|---|---|
| `warehouses[].id`, `warehouses[].label`, `warehouses[].refsInStock` | `GET /api/dashboard/summary` |
| Last scan timestamp | local state (`lastStockScan`) updated after scan stream success |
| `wizhard.productsToFill` | `GET /api/dashboard/summary` |
| `readyToPush.count` | `GET /api/dashboard/summary` |
| `channels[].id`, `channels[].label` | `GET /api/dashboard/summary` |
| `channels[].googleAdsCampaignsProgrammed` | `GET /api/dashboard/summary` |
| `channels[].sales24hCents` | `GET /api/dashboard/summary` |
| `suppliers.lastInvoiceDate` | `GET /api/dashboard/summary` |

## User actions
- Click **Scan Warehouses** -> `GET /api/warehouses/sync-all/stream` (SSE)
- Click **Push products to warehouses (Y products to push)** -> `POST /api/sync/channel-availability`
- Click warehouse node -> `/warehouses/[id]`
- Click channel node -> `/channels/[id]`
- Click **SUPPLIERS** -> `/suppliers`

## State behavior

### Loading
- Skeleton placeholders per block

### Empty
- Missing-data fallback text per block

### Error
- Block-level error without blocking unrelated sections

### Success
- All blocks render with live values
- Last scan and push counts visible

## Responsive notes
- Desktop: network-like multi-block layout
- Mobile: vertical flow order (Warehouses -> Wizhard -> Sale Channels -> Suppliers)

## Accessibility notes
- Buttons and nodes have explicit text labels
- Dates should be rendered with readable text and optional `<time>` metadata
