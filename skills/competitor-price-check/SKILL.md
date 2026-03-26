---
name: competitor-price-check
description: Use when checking live competitor prices for a product across Amazon (8 country domains), Worten, El Corte Inglés, Boulanger, Darty, JoyBuy, FNAC, PC Componentes, and MediaMarkt. Invoke for pricing research, margin analysis, or competitive positioning on a known Wizhard SKU.
---

# Competitor Price Check

## Overview

Searches 8 European competitor websites and returns a structured price table for a given product.
Uses Playwright MCP for live scraping, WebFetch + Google for bot-protected sites.

**Required tools:** `mcp__playwright__*`, `WebFetch`, Firecrawl API (key in `.dev.vars` as `FIRECRAWL_API_KEY`)
**No extra paid APIs beyond Firecrawl (already in project).**

Per-competitor protocols, selectors, and URL patterns: see `competitors.md` in this directory.

---

## Step 1 — Load product spec from Wizhard

Before any scraping, fetch the product once:

```
GET /api/products/{sku}
Authorization: Bearer {AGENT_BEARER_TOKEN}
```

Store locally for this run: `title`, `brand`, `model_ref`, `cpu`, `gpu`, `ram`, `storage`, `screen_size`, `resolution`.

If 404 → abort immediately with "SKU not found in Wizhard."

---

## Step 2 — Determine competitor scope

**If the SKU is a laptop (NX/NH prefix):** Laptops are country-localized — each SKU is sold only in its own market. Before searching, identify the product's country from its keyboard layout field (e.g. `keyboard_layout: "FR"` → France). Then search **only the competitors listed for that country** in `competitors.md` (Competitors by Country section). Do not search competitors from other countries.

**If the SKU is not a laptop:** Search all applicable competitors as usual.

## Step 3 — Search & match

Never halt on a single competitor failure — always attempt all active competitors for the scope and report all results.

### Search priority (try in order)

1. **Exact SKU** → if a single matching result → navigate to product page → extract price → **Confirmed**
2. **Model ref** (e.g. `Acer SFG16-72`) → if a single clear result → navigate → **Verify**
3. **Product name** → multiple results expected → must attribute-scan before navigating (see below)

### Attribute scan (required when name search returns multiple results)

Product names map to 10+ variants at different price points. Never report a price from a name-only match without this step.

1. Extract from each result card: CPU, GPU, RAM, storage, screen size, resolution
2. Compare each against the spec loaded in Step 1
3. Navigate only to the result where attributes are closest
4. If attributes align → report as **Verify**
5. If attributes differ (different RAM, storage, CPU, or model generation) → report as **Spec mismatch** and **still record the price** with spec details appended to competitor name (see Step 8)
6. If no result found at all → **Not listed**

### Confidence levels

| Level | Condition |
|-------|-----------|
| Confirmed | Exact SKU found in title or product attributes |
| Verify | Model ref or attribute match — SKU not found |
| Spec mismatch | Same model family found but different spec (RAM/storage/CPU/gen) — price recorded with spec note |
| Not listed | Searched successfully, no matching result found |
| Blocked | Scraping failed and cache also unavailable |

---

## Step 4 — Per-competitor protocols

Each competitor uses a layered approach. Try layers in order, stop at first success:

- **Layer 1:** Last known working URL pattern + selectors (fast path)
- **Layer 2:** Discovery protocol when Layer 1 selectors are stale (probe + iterate)
- **Layer 3:** Google search via **Firecrawl** (preferred) or Playwright fallback (for bot-blocked sites or repeated Layer 2 failure)
  - **Do NOT use WebFetch for Google** — it returns a JS challenge page, not results
  - **Preferred:** `POST https://api.firecrawl.dev/v1/scrape { "url": "https://www.google.com/search?q=site:{domain}+{term}", "formats": ["markdown"] }` — runs in parallel, ~2.5s for all competitors
  - **Fallback:** `browser_navigate("https://www.google.com/search?q=site:{domain}+{term}")`
  - Prices and stock status appear directly in Google's rich snippets

Full protocols in `competitors.md`.

---

## Step 5 — Verify URL before committing

Before recording any result (for output or DB write), verify every URL that is not already **Confirmed** by exact SKU:

1. Scrape the URL with Firecrawl: `POST https://api.firecrawl.dev/v1/scrape { "url": "<found_url>", "formats": ["markdown"] }`
2. Check that the model ref (e.g. `A17-51M`, `PHN18-72`, `TMP614-54-TCO`) appears in the returned markdown
3. **Pass** → proceed; record as Confirmed or Verify as appropriate
4. **Fail** (model ref absent) → do not write this URL; re-search or mark as Not listed

**Skip this step only when:**
- The URL came from an exact SKU search that returned a single result (already Confirmed)
- The site is known to block Firecrawl (Worten, JoyBuy) — use Playwright instead

This step prevents storing category pages, search result pages, or wrong-product URLs in the DB. The API will also reject any URL with no path beyond the domain, so a homepage URL will cause the write to fail.

---

## Step 7 — Output

Return a single markdown table after all checks:

| Competitor | Price | Was | Discount | Match | Spec | URL | Method | Freshness |
|---|---|---|---|---|---|---|---|---|
| Amazon.es | 899 EUR | — | — | Confirmed | ours | [link] | Live | Now |
| Worten.es | 849 EUR | 999 EUR | -15% | Confirmed | ours | [link] | Live | Now |
| El Corte Ingles | 920 EUR | — | — | Verify | ours | [link] | Live | Now |
| MediaMarkt.es | 599 EUR | — | — | Spec mismatch | 16GB/512GB | [link] | Live | Now |
| Boulanger | — | — | — | Not listed | — | — | Live | Now |
| JoyBuy | — | — | — | Not listed | — | — | Live | Now |
| FNAC | 879 EUR | — | — | Verify | ours | [link] | Google cache | ~7d |
| PC Componentes | 869 EUR | — | — | Confirmed | ours | [link] | Google cache | ~7d |
| MediaMarkt | — | — | — | Blocked | — | — | Cache failed | — |

Follow the table with:
- **5 cheapest prices found** (across all competitors, ranked cheapest first, spec-mismatch entries included and labelled)
- **Lowest confirmed price:** [price] at [competitor]
- **Lowest overall (including Verify):** [price] at [competitor] — verify manually

For multi-variant products, note which configuration the price applies to (e.g. "32GB RAM / 1TB SSD config").

---

## Step 8 — Write result to Wizhard database

After completing all competitor checks, PATCH the product in Wizhard.

**If at least one price was found**, collect ALL prices found across all competitors (including spec-mismatch results) and submit the 5 cheapest, sorted ascending:
```
PATCH /api/products/{sku}
{
  "fields": {
    "competitorPrices": [
      { "price": 599, "url": "https://...", "priceType": "normal", "competitorName": "MediaMarkt.es [16GB/512GB]" },
      { "price": 849, "url": "https://...", "priceType": "promo", "competitorName": "Worten.es" },
      { "price": 869, "url": "https://...", "priceType": "normal", "competitorName": "PC Componentes" },
      { "price": 879, "url": "https://...", "priceType": "normal", "competitorName": "FNAC" },
      { "price": 899, "url": "https://...", "priceType": "normal", "competitorName": "Amazon.es" }
    ]
  },
  "triggeredBy": "agent"
}
```

**Spec-mismatch entries:** Append the actual spec in brackets to `competitorName`, e.g. `"MediaMarkt.nl [8GB/128GB]"`, `"Amazon.it [i7-13620H/16GB]"`, `"Bol.com [RTX5060/32GB/512GB]"`. This preserves the price as market context while making the spec difference visible in the dashboard.

The array replaces all stored competitor prices for the SKU. Rank is assigned automatically by price (cheapest = rank 1). Always submit up to 5 — never just 1. Include every competitor that had a result, up to the cheapest 5.

**If NO competitor has the product (all results are Not listed or Blocked):**
```
PATCH /api/products/{sku}
{ "fields": { "competitorPrice": 0, "competitorUrl": "https://not-listed", "competitorPriceType": "normal" }, "triggeredBy": "agent" }
```

Writing `competitorPrice: 0` + `competitorUrl: "https://not-listed"` marks the SKU as "searched, nothing found" so future agents skip it and don't re-search.

> **Note:** The query that identifies SKUs needing a price check must exclude both `competitorPrice IS NOT NULL` AND `competitorUrl = 'https://not-listed'`.

**Reading back:** `GET /api/products/{sku}` returns `competitor.all[]` with all stored ranks, and `competitor.price/url/priceType` for rank 1 (cheapest).

---

## Rules

- Fetch product spec once at the start — never mid-run
- Run all applicable competitors regardless of failures
- Never report a price from a name-only search without attribute verification
- Distinguish "Not listed" (searched, nothing found) from "Blocked" (could not search)
- All prices in EUR — note original currency if a site shows non-EUR
- Flag all Google cache results with estimated staleness (~7d default)
- If a product appears to be an exclusive model with no cross-listing, state that explicitly
- **Never scan store.acer.com** — it is Acer's own store, not a third-party competitor. Do not include it in any search, result table, or database write.
- **URL must be a product page** — before writing any URL to the DB, verify it contains a product identifier in the path (ASIN, product slug, product ID, `/mpXXXXX/`, `/OffersOfProduct/`, etc.). Never store a homepage (`https://geizhals.de`), a search result URL (`?fs=`, `?q=`, `/search?`), or a category/listing page. If you only have a search/category URL, navigate to the actual product listing first.
- **Geizhals `?fs=` is a search URL** — never store it directly. Navigate to the product detail page (URL pattern: `/acer-{model}-{sku}-a{id}.html`) and store that.
- **SKU regional variants** — Acer SKU suffixes encode the market (EF=France, EG=Germany, EH=Netherlands, ED=Nordic/Denmark, etc.). A product not found under its exact SKU may exist under a spec-equivalent variant. Note the mismatch explicitly — never silently substitute a different-market SKU as if it were the same.
- **Always record spec-mismatch prices** — if a competitor carries the same model family but a different configuration (different RAM, storage, CPU, or generation), record the price anyway. Append the actual spec in brackets to `competitorName`: `"MediaMarkt.nl [8GB/128GB]"`. Never discard a price just because the spec doesn't perfectly match ours. These entries provide useful market context even when not directly comparable.
