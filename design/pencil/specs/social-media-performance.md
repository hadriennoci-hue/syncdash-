# Spec - Social Media Performance (/social-media/performance)

## Route
`/social-media/performance`

## Purpose
Account-level comparison table for social performance in a selected date range.

## Primary blocks
1. **Header + date filters**
2. **Performance table** (one row per account)
3. **Refresh action**

## Data displayed (field names)
| Field | Source |
|---|---|
| `postMetrics[]` | `GET /api/social/analytics/curated?from&to` |
| `accountId`, `accountLabel`, `accountHandle`, `platform` | `postMetrics[]` |
| Per-post `impressions`, `engagements`, `linkClicks` | `postMetrics[]` |
| Aggregated in UI: `posts`, `impressions`, `engagements`, `linkClicks`, `er`, `ctr`, `avgImpressionsPerPost` | computed from `postMetrics[]` |

## User actions
- Change date range
- Click Refresh to reload dataset

## State behavior

### Loading
- "Loading performance..."

### Empty
- "No social performance rows for this period."

### Error
- API error surfaced by query layer

### Success
- Account table sorted by ER descending

## Responsive notes
- Desktop/tablet: horizontal-scroll table
- Mobile: same table in overflow container

## Accessibility notes
- Percent metrics shown as text values
- Date inputs are native controls
