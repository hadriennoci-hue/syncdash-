---
name: competitor-price-check
description: Use when checking live competitor prices for a product across Amazon (8 country domains), Worten, El Corte Inglés, Boulanger, Darty, JoyBuy, FNAC, PC Componentes, and MediaMarkt. Invoke for pricing research, margin analysis, or competitive positioning on a known Wizhard SKU.
---

# Competitor Price Check

## Overview

Searches 8 European competitor websites and returns a structured price table for a given product.
Uses Playwright MCP for live scraping, WebFetch + Google for bot-protected sites.

**Required tools:** `mcp__playwright__*`, `WebFetch`
**No paid APIs.**

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
3. Navigate only to the result where attributes align
4. Report as **Verify**
5. If no result's attributes match → **Not listed**

### Confidence levels

| Level | Condition |
|-------|-----------|
| Confirmed | Exact SKU found in title or product attributes |
| Verify | Model ref or attribute match — SKU not found |
| Not listed | Searched successfully, no matching result found |
| Blocked | Scraping failed and cache also unavailable |

---

## Step 4 — Per-competitor protocols

Each competitor uses a layered approach. Try layers in order, stop at first success:

- **Layer 1:** Last known working URL pattern + selectors (fast path)
- **Layer 2:** Discovery protocol when Layer 1 selectors are stale (probe + iterate)
- **Layer 3:** Google search via Playwright (for bot-blocked sites or repeated Layer 2 failure)
  - **Do NOT use WebFetch for Google** — it returns a JS challenge page, not results
  - Navigate with Playwright: `browser_navigate("https://www.google.com/search?q=site:{domain}+{term}")`
  - Prices and stock status appear directly in Google's rich snippets

Full protocols in `competitors.md`.

---

## Step 5 — Output

Return a single markdown table after all 8 checks:

| Competitor | Price | Was | Discount | Match | URL | Method | Freshness |
|---|---|---|---|---|---|---|---|
| Amazon.es | 899 EUR | — | — | Confirmed | [link] | Live | Now |
| Worten.es | 849 EUR | 999 EUR | -15% | Confirmed | [link] | Live | Now |
| El Corte Ingles | 920 EUR | — | — | Verify | [link] | Live | Now |
| Boulanger | — | — | — | Not listed | — | Live | Now |
| JoyBuy | — | — | — | Not listed | — | Live | Now |
| FNAC | 879 EUR | — | — | Verify | [link] | Google cache | ~7d |
| PC Componentes | 869 EUR | — | — | Confirmed | [link] | Google cache | ~7d |
| MediaMarkt | — | — | — | Blocked | — | Cache failed | — |

Follow the table with:
- **Lowest confirmed price:** [price] at [competitor]
- **Lowest overall (including Verify):** [price] at [competitor] — verify manually

For multi-variant products, note which configuration the price applies to (e.g. "32GB RAM / 1TB SSD config").

---

## Step 6 — Write result to Wizhard database

After completing all competitor checks, PATCH the product in Wizhard.

**If at least one price was found**, send all found prices as an array (up to 5, sorted cheapest first):
```
PATCH /api/products/{sku}
{
  "fields": {
    "competitorPrices": [
      { "price": 849, "url": "https://...", "priceType": "promo", "competitorName": "Worten.es" },
      { "price": 869, "url": "https://...", "priceType": "normal", "competitorName": "PC Componentes" },
      { "price": 899, "url": "https://...", "priceType": "normal", "competitorName": "Amazon.es" }
    ]
  },
  "triggeredBy": "agent"
}
```

The array replaces all stored competitor prices for the SKU. Rank is assigned automatically by price (cheapest = rank 1). Maximum 5 entries.

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
