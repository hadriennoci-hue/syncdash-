# Spec - Ads Pipeline (/ads/pipeline)

## Route
`/ads/pipeline`

## Purpose
Operational planning board for ad campaigns. Manage campaign lifecycle from draft to approved/scheduled/live with editable campaign details.

## Primary blocks
1. **Provider columns** - Google Ads, Meta Ads, TikTok Ads
2. **Upcoming lane** - non-live campaigns (`draft`, `approved`, `scheduled`)
3. **History lane** - latest `live` / `paused` / `completed` / `canceled`
4. **Edit modal** - non-breaking campaign fields + status save actions

## Data displayed (field names)
| Field | Source |
|---|---|
| `campaignPk`, `name`, `status`, `objective` | `GET /api/ads/campaigns` |
| `providerId`, `accountName` | `GET /api/ads/campaigns` |
| `startAt`, `endAt` | `GET /api/ads/campaigns` |
| `budgetMode`, `budgetAmountCents`, `currencyCode` | `GET /api/ads/campaigns` |
| `destinationType`, `productSku`, `destinationPending`, `destinationUrl` | `GET /api/ads/campaigns` |
| `creativeHeadline`, `creativePrimaryText`, `creativeDescription`, `creativeCta` | `GET /api/ads/campaigns` |
| `productImageUrl` | `GET /api/ads/campaigns` |

## User actions
- Expand card for full details
- Approve/cancel/schedule quick actions: `PATCH /api/ads/campaigns/:id/status`
- Edit non-live campaign: `PATCH /api/ads/campaigns/:id`
- Save from editor as:
  - `draft`
  - `approved` (only if no period selected)
  - `scheduled` (requires start datetime)

## State behavior

### Loading
- Provider columns with placeholder text

### Empty
- Per-provider: "No upcoming campaigns" / "No campaign history"

### Error
- Inline API error feedback from mutation responses

### Success
- Provider columns populated
- Status changes reflected after query refresh

## Responsive notes
- Desktop: 3 provider columns
- Tablet/mobile: stacked provider sections with horizontal card scrolling

## Accessibility notes
- Cards remain keyboard-focusable action targets
- Status/action buttons use text labels (not color only)
