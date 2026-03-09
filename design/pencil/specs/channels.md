# Spec — `/channels`

**Status:** `implemented-ready`
**Frame:** `xfLJV` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/channels/page.tsx`

---

## Purpose

List view of all 6 sale channels with live connector status, last push timestamp, and per-channel product push summary. Entry point to each channel detail.

---

## Data Bindings

| Field | Source | Endpoint |
|---|---|---|
| Channel list | `salesChannels` table | `GET /api/channels` (implicit from DB) |
| Health status per channel | `apiHealthLog` latest entry | `GET /api/health` |
| Last push timestamp | `salesChannels.lastPush` | same |
| Push queue count per channel | `products.pushed_*` = `2push` | `GET /api/products?pushedPlatform=<id>&status=2push` |

### Channel Display

| platform | Display Label | Connector Type |
|---|---|---|
| `woocommerce` | COINCART.STORE | API — WooCommerce REST |
| `shopify_komputerzz` | KOMPUTERZZ.COM | API — Shopify GraphQL |
| `shopify_tiktok` | Tech Store (TikTok) | API — Shopify GraphQL |
| `ebay_ie` | eBay.ie | API — eBay REST |
| `xmr_bazaar` | XMR Bazaar | **Browser runner** (Playwright) |
| `libre_market` | Libre Market | **Browser runner** (Playwright) |

> `platform_4` and `platform_5` are stubs — do NOT render.

---

## UI States

| State | Trigger | Rendering |
|---|---|---|
| `loading` | Initial fetch | Skeleton cards (6 placeholders) |
| `empty` | No channels returned | Message: "No channels configured." |
| `error` | Fetch fails | Error banner: "Could not load channel status." with retry button |
| `success` | Data loaded | Channel card grid |

---

## Channel Card Structure

Each card shows:
- Platform icon / logo badge
- Display label
- Connector type badge (`API` or `Browser runner` — orange badge for browser-runner)
- Health indicator (green dot = healthy, red = error, gray = unknown)
- Last push: relative timestamp or `—`
- Products queued for push: count badge (if > 0 → amber)
- CTA: "View channel →" link to `/channels/[id]`

---

## User Actions

| Action | Endpoint | Notes |
|---|---|---|
| View channel detail | navigate to `/channels/[id]` | — |
| Run channel availability sync | `POST /api/sync/channel-availability` | Button in page header; syncs all channels |

---

## Edge / Error States

- **Browser runner channels:** display "Manual push only" instead of health status. No connector health check runs against them.
- **Health unknown:** if `apiHealthLog` has no entry for a channel, show gray "—" status.
- **Push queue warning:** if any channel has queued products, show amber banner: "X products are queued for push to [channel]."

---

## Responsive Behavior

- Desktop (≥1024px): 3-column grid of cards
- Tablet (768–1023px): 2-column grid
- Mobile (<768px): single column stack

---

## Accessibility Notes

- Channel cards are `<article>` with `aria-label="[Channel Name] channel"`
- Health indicators must have a text tooltip (not just color)
- "Browser runner" badge must include title: `title="This channel uses local Playwright automation, not an API connector"`
