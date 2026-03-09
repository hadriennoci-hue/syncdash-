# Spec - Ads Performance (/ads/performance)

## Route
`/ads/performance`

## Purpose
Campaign comparison table for ad performance over a selected date range.

## Primary blocks
1. **Header + date filters**
2. **Campaign performance table** (one row per campaign)
3. **Refresh action**

## Data displayed (field names)
| Field | Source |
|---|---|
| `rows[]` from curated analytics | `GET /api/ads/analytics/curated?from&to` |
| `campaignPk`, `campaignName`, `providerId`, `accountName`, `productSku` | curated `rows[]` |
| `spendCents`, `impressions`, `clicks`, `providerConversions`, `shopifyOrders`, `shopifyNetRevenueCents` | curated `rows[]` |
| Derived: `ctr`, `cpcCents`, `cpaCents`, `roas` | computed in UI from curated rows |

## User actions
- Change date range
- Click Refresh to reload dataset

## State behavior

### Loading
- "Loading performance..."

### Empty
- "No campaign performance rows for this period."

### Error
- API error surfaced by query layer

### Success
- Sorted campaign table (best ROAS first)

## Responsive notes
- Desktop/tablet: horizontal-scroll table
- Mobile: same table in overflow container

## Accessibility notes
- Numeric columns remain textual (screen-reader friendly)
- Date filters are native date inputs
