# TikTok-Readiness Architecture Spec — Wizhard → Shopify → TikTok Shop

> Status: **DRAFT for review** · 2026-07-27 · scope: architecture, not a per-product task
> Goal: prepare Wizhard (source of truth) and the Shopify **Tech Store** (`qanjg5-0h.myshopify.com`)
> so that when TikTok Shop is later connected to that Shopify and imports products, the **maximum is
> auto-filled** and manual work in TikTok Seller Center is minimal — for *any* product in
> `tiktok_selection`, not a fixed list.

TikTok is **not connected yet**. The current 8 pilot products and the items already in the Tech Store
are disposable test data. Nothing here targets specific SKUs.

---

## 0. Guiding principle

**Put every field in the *standard* Shopify slot the TikTok import reads.** Wizhard stays the single
source of truth; the channel push *materialises* Wizhard data into Shopify's standard locations
(standard product category, category/taxonomy metafields, native compliance metafields, variant
shipping data). Anything we leave in a non-standard place (free-text description, `custom` metafields)
the TikTok app cannot auto-map, and becomes manual work at import time.

We cannot *verify* the exact Shopify→TikTok field mapping until the channel is connected. Designing to
the **standard** slots is the strategy that maximises auto-fill regardless of the app's internals, and
converts the residual uncertainty into a short "verify at connect" checklist (§7) rather than a blocker.

---

## 1. Current-state audit (from code, 2026-07-27)

| # | Finding | Location |
|---|---------|----------|
| 1 | **Spec attributes are never pushed to the TikTok channel.** The attribute→metafield push is gated to Komputerzz only. | `channel-sync.ts:1398` (`platform === 'shopify_komputerzz'`) |
| 2 | **Shopify category is hardcoded to the Electronics *root*** for every product/channel. TikTok has nothing granular to map a category or attribute set from. | `channel-sync.ts:1213`; `shopify.ts:11,590,684` |
| 3 | Even on Komputerzz, attributes are written to the **`custom` namespace**, not Shopify's standard taxonomy metafields → not auto-mappable by marketplace apps. | `shopify.ts:~1499` (`namespace: 'custom'`) |
| 4 | **No package dimensions anywhere.** Only `products.weight` (kg). `dimensions` exists as a free-text *spec* attribute for a couple categories, not structured shipping data. Weight is also not in `ProductPayload`. | `schema.ts` products; `types.ts:93` |
| 5 | **No GPSR/compliance fields.** Only `country_of_manufacture`. No manufacturer block, no EU Responsible Person, no CE/WEEE/safety. | `schema.ts` products |
| 6 | **No `warranty`, no `box_contents`.** Both currently live (if at all) inside the description prose. | `schema.ts` |
| 7 | **Attribute values are inconsistent free text** ("Up to 16,000 DPI", "16.8M RGB", "240 minutes" vs "4 h"). A normalization map exists but is partial. | `constants/attribute-short-values.ts` |
| 8 | **EAN is null** for most special SKUs. Pushed as `barcode` only when present. | `products.ean` |

What *does* already work and is reusable:
- Rich spec store: `product_metafields` `namespace='attributes'` (~110 known keys in `SHOPIFY_PRODUCT_ATTRIBUTE_KEY_MAP`).
- A raw→short value map per collection (`ATTRIBUTE_SHORT_VALUE_MAP`) — the seed for normalization.
- `tiktok_selection` table (the 30–40 set).
- Per-channel push flags (`pushedShopifyTiktok`) and a working Shopify GraphQL connector.
- `syncProductAttributeMetafields()` — a metafield writer we can repoint from `custom` to standard.

### 1b. Live Tech Store audit (read-only Admin API, 2026-07-27)

Inspected `qanjg5-0h.myshopify.com` ("Tech Store", EUR, 8 test products) with the stored D1 token. Reality vs. the code-only reading:

- **Category is auto-guessed by Shopify from the title, and is sometimes wrong.** Not the root Electronics the code implies — Shopify's ML assigned granular standard categories. Correct for most (Mice & Trackballs, Wireless Routers, Laptop Backpacks, Gaming Pads) but **wrong for two**: 13-in-1 dock → *Office Supplies > Notebooks & Notepads* (matched "notebook", the paper kind), Galea 330 earbuds → *Mice & Trackballs*. **Conclusion: the danger is a silently-wrong guessed category, not a missing one → drive category deterministically from Wizhard, and set `productType` so any fallback guess has a signal.**
- **No product metafield *definitions* exist.** The only metafields present are `woo` / `woo_attribute` leftovers from the Komputerzz/Woo import — not the `attributes` namespace, nothing a TikTok mapping could consume. The spec data effectively isn't on the store.
- **Weight = 0 kg on all 8.** Package dimensions absent.
- **Barcodes inconsistent**: some real EANs, some empty, and the Nitro controller has its **Acer part number `GP.OTH11.074` wrongly stored as `barcode`** (a PN is not a GTIN). Needs validation on push.
- `productType` empty on all 8.
- App token scopes lack `read_publications` / `read_metaobjects` → couldn't list installed sales channels or metaobject definitions (noted; widen scopes when needed).

**Operational note (tokens):** local `.dev.vars` Shopify-TikTok secret is **stale** (client_credentials OAuth → "invalid client secret"); `.env.local` holds a *different* app that returns "application_cannot_be_found". The working token is the one the daily refresh writes to D1 — read it with
`wrangler d1 execute syncdash-db --remote --command "SELECT access_token FROM platform_tokens WHERE platform='shopify_tiktok'"`.
Tokens last 24 h; the daily refresh (the home-page "Test API connections" button / cron) runs ~04:00 UTC.

---

## 2. Target data model — Wizhard schema additions

Additive only (never drop columns; nullable + backfill — per repo migration rules).

### 2.1 `products` — new columns
```
package_length_mm     INTEGER   -- shipped parcel, not product
package_width_mm      INTEGER
package_height_mm      INTEGER
package_weight_g      INTEGER   -- shipped parcel; distinct from product weight
warranty_months       INTEGER
box_contents          TEXT      -- JSON array, e.g. ["Mouse","USB cable","Quick start guide"]
shopify_category_gid  TEXT      -- granular standard taxonomy node (see §3); NOT the root
tiktok_category_id    TEXT      -- optional cache of the resolved TikTok category
-- ean, country_of_manufacture already exist → enforce as required for tiktok_selection
```

### 2.2 `suppliers` — GPSR constants (inherited by all that supplier's products)
```
manufacturer_name         TEXT   -- legal manufacturer (e.g. "Acer Incorporated"), not the factory, not CPYou
manufacturer_address      TEXT
manufacturer_email        TEXT
eu_rp_name                TEXT   -- Acer's EU Responsible Person (Ragequit is DISTRIBUTOR, not the RP)
eu_rp_address             TEXT
eu_rp_email               TEXT
default_country_of_origin TEXT   -- customs origin, usually 'CN' for Acer accessories
```
Rationale: for a single-supplier catalogue these are near-constant. Model once, inherit per product,
allow a per-product override later via an `attributes`/`compliance` metafield if a product ever differs.
This is the standard **distributor** treatment — see the GPSR note in the TikTok field guide on Proton Drive.

### 2.3 New table — `channel_category_map` (the linchpin)
Maps our internal product taxonomy to each channel's category system, so a product's granular category
is *data*, not a hardcoded constant.
```
CREATE TABLE channel_category_map (
  taxonomy_key            TEXT NOT NULL,  -- our internal key, e.g. 'gaming_mouse', 'earbuds', 'backpack', 'docking_station', 'game_controller', 'router'
  platform                TEXT NOT NULL,  -- 'shopify_tiktok' | 'shopify_komputerzz' | ...
  shopify_category_gid    TEXT,           -- standard taxonomy node GID for that key
  tiktok_category_id      TEXT,           -- known-good TikTok category id (filled once TikTok is live)
  required_attribute_keys TEXT,           -- JSON array of attribute keys TikTok marks mandatory for this category
  PRIMARY KEY (taxonomy_key, platform)
);
```
`products` gains (or reuses `product_type` as) a `taxonomy_key`. The push resolves
`taxonomy_key → shopify_category_gid` instead of defaulting to `el`.

### 2.4 New table — `channel_field_rules` (which fields go to which channel)

Confirmed with Hadrien: model channel divergence as **data, not `if (platform === …)` branches**. TikTok needs
fields Komputerzz doesn't (package dims, GPSR, normalized attributes) and vice-versa. Replaces the scattered
branches (e.g. `channel-sync.ts:1398` attribute push gated to Komputerzz).
```
CREATE TABLE channel_field_rules (
  platform   TEXT NOT NULL,   -- 'shopify_tiktok' | 'shopify_komputerzz' | 'coincart2' | ...
  field_key  TEXT NOT NULL,   -- 'title'|'description'|'ean'|'weight'|'package_dims'|'attributes'|'gpsr'|'category'|'images'|...
  pushed     INTEGER NOT NULL DEFAULT 1,  -- 0 | 1
  required   INTEGER NOT NULL DEFAULT 0,  -- 1 = block the push / readiness gate if missing
  notes      TEXT,
  PRIMARY KEY (platform, field_key)
);
```
The push loop reads this table to decide what to materialise per channel; the readiness gate (§5) reads `required`.
Seed it so `shopify_tiktok` requires `package_dims`, `attributes`, `category`, `images(>=5)`, `gpsr`; Komputerzz keeps its current narrower set.

### 2.5 Attribute normalization
- Promote `ATTRIBUTE_SHORT_VALUE_MAP` into the canonical normalizer: every attribute value stored raw
  **and** resolved to a clean enum/short form.
- Push the **normalized** value to Shopify's standard taxonomy metafield for that category.
- Keep the short form for the "power image" bullets (already the concept behind the short map).

---

## 3. Push changes — `channel-sync.ts` + `shopify.ts`

1. **Un-gate attributes for TikTok.** `channel-sync.ts:1398` currently runs the attribute metafield push
   only for `shopify_komputerzz`. Extend to `shopify_tiktok`.
2. **Write to standard taxonomy metafields, not `custom`.** `syncProductAttributeMetafields()` writes
   `namespace:'custom'`. For TikTok auto-mapping, set the product's **standard category** and its
   **category metafields** (the taxonomy attribute keys tied to that category). This is the higher-effort
   item — it needs the per-category taxonomy attribute keys — but it is the difference between TikTok
   pre-filling attributes vs. you typing them. *(Fallback if effort must be staged: keep `custom` +
   accept a one-time manual attribute-mapping in the TikTok channel.)*
3. **Set granular `shopify_category_gid` per product** (from `channel_category_map`) instead of the
   hardcoded `el` at `channel-sync.ts:1213`.
4. **Push shipping data.** Add `weight` to `ProductPayload` and push it to the variant. Package
   dimensions: Shopify has **no native per-variant L×W×H** (only weight) — so push dims into a
   metafield as best-effort and treat them as possibly-manual on TikTok (see §7). Store them in Wizhard
   regardless; they're needed for the field-guide checklist and TikTok shipping.
5. **Push GPSR to Shopify's native product-compliance metafields** (manufacturer + EU responsible
   person). Exact standard keys to confirm against the current Shopify taxonomy at implementation time.
6. **Enforce media/copy minimums at push**: ≥5 square images incl. the power image at slot 2;
   description ≥500 chars including a "What's in the box" block; title 40–150 chars.

---

## 4. Field-by-field: Wizhard → Shopify → TikTok

| Data | Wizhard source | Shopify standard slot | TikTok import |
|------|----------------|-----------------------|---------------|
| Title | `products.title` | product title | auto |
| Description | `products.description` | descriptionHtml | auto |
| Images (≥5 + power image) | `product_images` | product media | auto |
| Price | `product_prices[shopify_tiktok]` | variant price | auto |
| EAN/GTIN | `products.ean` | variant barcode | auto |
| **Category** | `taxonomy_key` → `channel_category_map` | **standard category (granular)** | **suggested → confirm** |
| **Category attributes** | `attributes` metafields (normalized) | **standard category metafields** | **auto if standard** |
| Package weight | `products.package_weight_g` | variant weight | auto/near |
| Package dims | `package_*_mm` | metafield (no native field) | likely manual (§7) |
| Manufacturer | `suppliers.manufacturer_*` | compliance metafields | auto if app reads them; else once |
| EU Responsible Person | `suppliers.eu_rp_*` | compliance metafields | auto if app reads them; else once |
| Country of origin | `products.country_of_manufacture` | metafield | auto/near |
| Warranty | `products.warranty_months` | metafield / description | manual/near |
| Box contents | `products.box_contents` | description block | manual/near |
| Video (≤5 MB) | not in Shopify pipeline | — | **manual** (Shopify doesn't carry it) |
| Brand authorization | — | — | **one-time** in TikTok |

---

## 5. Readiness gate in Wizhard ("TikTok ready?")

Compute a per-product readiness flag (mirrors the field-guide checklist and the existing tier concept),
surfaced on the product page and as a filter, so a product isn't marked pushable to `shopify_tiktok`
until it passes:

- [ ] ≥5 images, all 1:1 and ≥800 px; slot 1 white-bg, no added text
- [ ] Power image present at slot 2
- [ ] Title 40–150 chars
- [ ] Description ≥500 chars incl. box contents
- [ ] `taxonomy_key` set and resolvable in `channel_category_map`
- [ ] All required category attributes present (from `required_attribute_keys`) and normalized
- [ ] `package_weight_g` + `package_*_mm` present
- [ ] `ean` present
- [ ] Supplier GPSR block complete (manufacturer + EU RP + origin)

---

## 5b. Image compliance policy + auto-rating (Wizhard)

TikTok constrains images, so Wizhard should **store the policy** and **rate every uploaded image** pass/warn/fail,
surfacing the result on the product and blocking a non-compliant set from the TikTok readiness gate. Mirrors the
Proton Drive field guide §1; kept here as the machine-checkable source.

### 5b.1 The policy (constants — single source of truth)
```
TIKTOK_IMAGE_POLICY = {
  min_px:            800,      // hard min for UK/IE (600 is US); reject below
  target_px:         1000,     // aim
  aspect_ratio:      1.0,      // 1:1; tolerance ±2%
  formats:           [jpg, png],
  max_bytes:         5_000_000,
  min_count_good:    5,        // <5 caps the listing below "Good"; hard min 4
  main_slot:         1,        // position 0
  main_bg:           "opaque_white",   // sample 4 corners, each channel >= 245, alpha opaque
  main_no_added_text: true,    // best-effort; flag for manual check, don't hard-fail
  banned:            [greyscale, borders, added_logo/text/price/badge, 3d_render/placeholder, duplicate_angle],
}
```
Store as a constant in `src/lib/constants/` (e.g. `tiktok-image-policy.ts`), versioned with the field guide.

### 5b.2 Per-image rating (checks, cheapest first)
Most checks run on data already stored (`product_images.width/height/url`); the white-bg/format/size checks need
a fetch (or R2 head + a corner-sample).

| Check | Source | Fail / Warn |
|-------|--------|-------------|
| Dimensions ≥ 800×800 | stored w/h | **fail** < 800 (warn 800–999) |
| Aspect ratio 1:1 (±2%) | stored w/h | **fail** if not square |
| Format jpg/png | URL/head | **fail** otherwise |
| File size ≤ 5 MB | head | **fail** over |
| Not greyscale | sampled pixels | **warn/fail** if near-zero saturation |
| Main image (pos 0) opaque-white corners | corner sample | **fail** if corners not ~white / transparent |
| Main image no added text | — | **manual flag** (don't auto-fail) |

### 5b.3 Storage — new columns on `product_images`
```
tiktok_status  TEXT     -- 'pass' | 'warn' | 'fail'
tiktok_issues  TEXT     -- JSON array of failed/warned check keys, e.g. ["ratio","min_px"]
rated_at       DATETIME
```
Recompute on image add/replace and on policy version bump. Product-level rollup for the readiness gate:
**≥5 images with `tiktok_status='pass'`, and position-0 passes the main-image checks.**

### 5b.4 Where it plugs in
- A `rateProductImages(sku)` function in `src/lib/functions/images.ts`, called after image upload/set.
- Surfaced as a badge in the product UI (green/amber/red) + a filter "TikTok image issues".
- Feeds the §5 readiness gate and the `channel_field_rules` `images` requirement for `shopify_tiktok`.

---

## 6. Rollout phases

1. **Schema + normalization** — add columns/table + Drizzle migration; promote the short-value map to a
   full normalizer. No behaviour change yet.
2. **Category map** — seed `channel_category_map` for the categories sold (mouse, earbuds, backpack,
   docking station, controller, router …); add `taxonomy_key` to products.
3. **Push wiring** — un-gate attributes for TikTok, set granular category, push weight/dims + GPSR.
   Guard behind the readiness gate so Komputerzz behaviour is untouched.
4. **Readiness gate + UI flag.**
5. **Verify-at-connect** (§7) once TikTok is live — fix whatever the app didn't auto-map.

---

## 7. Verify-at-connect checklist (deferred until TikTok ↔ Shopify is live)

Because the app's mapping can't be observed yet, confirm on the first real import and adjust:
- Does TikTok auto-adopt the Shopify **standard category** → does it pre-load the attribute set?
- Do **standard category metafields** populate TikTok category attributes?
- Does TikTok read Shopify's **compliance metafields** (manufacturer / EU RP), or must these be entered
  once in Seller Center / the app's compliance section?
- Does **package weight** flow from the variant? Do **dimensions** (metafield) flow, or are they manual?
- Which fields remain manual → fold them into a short per-product "TikTok finish" checklist.

---

## 8. Decisions

**Resolved (Hadrien, 2026-07-27):**
- **Integration = native "TikTok for Shopify"** sales channel (not a third-party connector). The native app maps
  Shopify **metafields → TikTok attributes** in a one-time interface → so the win is *consistent, defined,
  normalized metafields*, not per-product pushes. Standard-taxonomy metafields preferred, but any **defined**
  namespace works since the mapping is manual-once — the real requirement is consistency + normalization, which
  also lets us keep/extend `syncProductAttributeMetafields` rather than rebuild it.
- **Specs modelled as metafields**, not metaobjects (metaobject *references* wouldn't map cleanly to TikTok attrs).
- **`channel_field_rules`** registry confirmed (§2.4) — channel divergence as data.
- **Image compliance**: store the policy + auto-rate every Wizhard image (§5b).
- **GPSR = supplier-level constants** (§2.2); Acer will provide the manufacturer + EU Responsible Person block soon
  (assume available). Ragequit is the **distributor**, so the RP is Acer's, never Hadrien/Ragequit.

**Still open:**
- **Dimensions home** (§3.4): native app auto-imports weight+L/W/H from Shopify, but Shopify has no native per-variant
  dimensions field → confirm at implementation whether they live in a metafield the app reads, or are entered once
  in the app's shipping defaults. Store them in Wizhard regardless.
- **Barcode hygiene**: enforce EAN-13 validation on push so part numbers (e.g. `GP.OTH11.074`) never land in `barcode`.
