# Competitor Protocols

> ⚠️ **Never search store.acer.com.** It is Acer's own official store — not a third-party competitor. Do not include it in any Google `site:` query, Layer 1/2/3 search, result table, or database write.

---

## Tool Selection: Firecrawl vs Playwright

**Use Firecrawl for all Google search (Layer 3) queries.** POST the Google search URL to `https://api.firecrawl.dev/v1/scrape` with `formats: ["markdown"]`. Key advantages vs Playwright:

- **Speed**: All queries run in parallel via API — ~2.5s for all competitors combined vs 60-150s sequential Playwright
- **No browser state**: No cookie consent, no CAPTCHA challenges, no page-load waits
- **Simplicity**: One HTTP call per query; parse the returned markdown for prices

**Use Playwright only for Layer 1 direct-site scraping** where Firecrawl is blocked:
- **Worten**: Cookiebot wall blocks Firecrawl (returns 467-char cookie banner only, no products)
- **JoyBuy**: Direct product URLs work with Layer 1 Playwright

**Timing reference** (tested in parallel batch):
- 5 Firecrawl Google calls: **2.4s total**
- Playwright per query: **5–15s sequential**

**Query format for Google via Firecrawl:**
```
POST https://api.firecrawl.dev/v1/scrape
{ "url": "https://www.google.com/search?q=site:{domain}+{search_term}&hl={lang}&gl={country}", "formats": ["markdown"] }
```

**Critical: Use name-based queries, not quoted SKUs.** `site:boulanger.com "NX.KSHEB.005"` returns 0 results; `site:boulanger.com Acer Aspire 15 A15-51M` returns prices. Google's `site:` filter with exact product names is the reliable pattern.

---

## Competitors by Country

Countries correspond to Acer store locales in Wizhard. **We only scrape sites marked ✓** — these have a defined protocol in this file. All other sites are listed for reference only and are not scraped.

### 🇮🇪 Ireland (`en-ie`)

> ⚠️ **We do NOT ship to the UK. Ireland is the only target market for `en-ie` (K-suffix) SKUs.**
> Never use currys.co.uk (GBP) prices — always use currys.ie (EUR). Amazon.co.uk ships to Ireland and shows EUR at checkout; use it as secondary only. Do NOT store GBP prices — always convert or prefer EUR-native sources.

| Site | Domain | Notes |
|------|--------|-------|
| Currys Ireland | currys.ie | ✓ Layer 1 (Firecrawl direct — `/search?q={model}`) — EUR prices |
| Harvey Norman | harveynorman.ie | ✓ Layer 3 (Google, gl=ie) — EUR prices, IE stock |
| Paradigit | paradigit.ie | ✓ Layer 3 (Google, gl=ie) — EUR prices; confirmed stocking Acer Aspire 17 A17-51M (€999). Product URL pattern: `/acer-{model-slug}/{id}/product` |
| Amazon | amazon.co.uk | Secondary — ships to IE, GBP prices (×1.18 to EUR) |
| Argos Ireland | argos.ie | Wide laptop range — not yet tested |

### 🇫🇷 France (`fr-fr`, `fr-be`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.fr | ✓ Layer 3 (gl=fr) |
| Boulanger | boulanger.com | ✓ Layer 3 only (Shadow DOM, CF-blocked) |
| Darty | darty.com | ✓ Layer 3 only (Cloudflare) |
| FNAC | fnac.com | ✓ Layer 3 only (Cloudflare) |
| JoyBuy | joybuy.fr | ✓ Layer 1 (FR domain only) |
| Cdiscount | cdiscount.com | ✓ Layer 1 (Firecrawl direct — `/search/10/{query}.html`) |
| Rue du Commerce | rueducommerce.fr | Owned by Cdiscount group — not yet tested |

### 🇧🇪 Belgium (`fr-be`, `nl-be`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.nl | Serves BE; nl domain |
| Bol | bol.com/be | Leading BE/NL marketplace |
| Coolblue | coolblue.be | Strong in NL+BE |
| MediaMarkt | mediamarkt.be | Physical + online |
| FNAC | fnac.be | French-speaking BE |

### 🇩🇪 Germany (`de-de`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.de | ✓ Layer 3 (gl=de) |
| MediaMarkt | mediamarkt.de | ✓ Layer 3 |
| Saturn | saturn.de | Sister brand to MediaMarkt (same Ceconomy group) |
| Alternate | alternate.de | Large IT/electronics e-tailer |
| Cyberport | cyberport.de | Strong on laptops & Apple |
| Notebooksbilliger | notebooksbilliger.de | Laptop specialist |

### 🇪🇸 Spain (`es-es`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.es | ✓ Layer 3 (gl=es) |
| Worten | worten.es | ✓ Layer 1 |
| El Corte Inglés | elcorteingles.es | ✓ Layer 1 |
| PC Componentes | pccomponentes.com | ✓ Layer 3 only (Cloudflare) |
| MediaMarkt | mediamarkt.es | ✓ Layer 3 |
| FNAC | fnac.es | ✓ Layer 3 only |
| Carrefour | carrefour.es | Carries entry-level laptops |

### 🇮🇹 Italy (`it-it`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.it | ✓ Layer 3 (gl=it) |
| MediaWorld | mediaworld.it | Italian brand name for MediaMarkt |
| Unieuro | unieuro.it | Italy's largest electronics chain |
| Euronics | euronics.it | Second largest chain (franchise model) |
| ePrice | eprice.it | Online-only; strong laptop catalogue |

### 🇳🇱 Netherlands (`nl-nl`, `nl-be`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.nl | ✓ Layer 3 (gl=nl) |
| Bol | bol.com | Leading NL marketplace |
| Coolblue | coolblue.nl | Electronics specialist, very strong in NL |
| MediaMarkt | mediamarkt.nl | ✓ Layer 3 |

### 🇫🇮 Finland (`fi-fi`)
| Site | Domain | Notes |
|------|--------|-------|
| Verkkokauppa | verkkokauppa.com | Finland's largest online electronics retailer |
| Gigantti | gigantti.fi | Elgiganten group brand for Finland |
| Prisjakt | prisjakt.nu | ✓ Layer 3 (Google gl=fi) — covers FI market alongside SE. Finnish results appear on prisjakt.nu. |
| Power | power.fi | Third major chain in FI |
| Amazon | amazon.se | Closest Amazon domain (SE); FI has no amazon.fi |

### 🇸🇪 Sweden (`sv-se`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.se | ✓ Layer 3 (gl=se) |
| Elgiganten | elgiganten.se | ✓ Layer 1 (Firecrawl direct — `/search?SearchTerm={model}`) |
| Prisjakt | prisjakt.nu | ✓ Layer 3 (Google gl=se) — Nordic price aggregator covering SE/NO/DK/FI. Search: `site:prisjakt.nu {model}`. Prices in SEK — convert to EUR (~×0.088). Product URLs: `/produkter/{id}` |
| NetOnNet | netonnet.se | Online-only; competitive pricing — not yet tested |
| Webhallen | webhallen.com | Enthusiast/gaming focus — not yet tested |
| Power | power.se | ~190 Nordic stores — not yet tested |

### 🇩🇰 Denmark (`da-dk`)
| Site | Domain | Notes |
|------|--------|-------|
| Elgiganten | elgiganten.dk | ✓ Layer 1 (Firecrawl direct — `/search?SearchTerm={model}`) |
| Prisjagt | prisjagt.dk | ✓ Layer 3 (Google gl=dk) — Danish price aggregator. Prices in DKK — convert to EUR (~×0.134). |
| Power | power.dk | Second largest chain — not yet tested |
| Proshop | proshop.dk | Pure-play online; IT/laptop focus — not yet tested |
| Komplett | komplett.dk | Scandinavian IT e-tailer — not yet tested |

### 🇳🇴 Norway (`no-no`)
| Site | Domain | Notes |
|------|--------|-------|
| Elkjøp | elkjop.no | Market leader; same group as Elgiganten |
| Prisjakt | prisjakt.no | ✓ Layer 3 (Google gl=no) — Norwegian price aggregator. Prices in NOK — convert to EUR (~×0.087). |
| Power | power.no | Strong #2 |
| Komplett | komplett.no | Large IT-focused e-tailer |
| Proshop | proshop.no | Online-only IT specialist |

### 🇵🇱 Poland (`pl-pl`)
| Site | Domain | Notes |
|------|--------|-------|
| Amazon | amazon.pl | ✓ Layer 3 (gl=pl) |
| Media Expert | mediaexpert.pl | Largest electronics chain in PL |
| RTV Euro AGD | euro.com.pl | Second largest chain |
| MediaMarkt | mediamarkt.pl | ✓ Layer 3 |
| Morele | morele.net | Online-only; strong IT catalogue |
| x-kom | x-kom.pl | Gaming/IT specialist |
| Komputronik | komputronik.pl | IT and laptop specialist |
| Allegro | allegro.pl | ✓ Layer 1 (Firecrawl direct — `/listing?string={query}`) |

---

## Cross-EU Price Comparison Sites

These are not country-specific retailers but aggregators covering multiple EU markets. Use them for accessories, niche products, and any product where per-country retailer searches return no results.

| Site | Domain | Markets | Notes |
|------|--------|---------|-------|
| geizhals.de | geizhals.de | ✓ DE/AT/PL/UK resellers | **Layer 1 (Firecrawl direct)** — search: `/?fs={sku_or_name}&hloc=de` — returns price, offer count, cheapest retailer. SKU search is exact. Confirmed working for all Acer accessory categories (monitors, GPUs, networking, docking). ⚠️ The `?fs=` search URL is NOT a product URL — always navigate to the product listing page (`/acer-{model}-{sku}-a{id}.html`) before storing. |
| idealo | idealo.de / idealo.fr / idealo.es / idealo.it / idealo.pl | ✓ DE/FR/ES/IT/PL | **Layer 1 (Firecrawl direct)** — search: `/MainSearchProductCategory.html?q={model}` — shows per-country prices with retailer links. Product pages: `/OffersOfProduct/{id}` return ranked offers with EUR prices. |
| Prisjakt / Prisjagt | prisjakt.nu (SE/FI) / prisjakt.no (NO) / prisjagt.dk (DK) | ✓ Nordic markets | **Layer 3 (Google)** — `site:prisjakt.nu {model}` or `site:prisjakt.no {model}`. Prices in local currency (SEK/NOK/DKK) — always convert to EUR. Use for Nordic SKUs (suffix ED=DK, EK=NO, ES=SE, EF≠FR for some Nordic variants — confirm by checking prisjakt). |

**Search pattern for geizhals.de:**
```
Firecrawl POST: https://geizhals.de/?fs={SKU_or_model}&hloc=de
```
Returns: product listing with `ab €X.XX` (lowest offer), offer count, and product page link.

**When to use:** Preferred for accessories (docking, networking, GPUs, peripherals, projectors) because geizhals indexes by exact SKU. Much faster than multiple site searches.

---

## Layer 2 — Universal Discovery Protocol

Use this when Layer 1 selectors fail for any competitor (site redesign, new layout).

1. Navigate to the competitor's homepage
2. Locate the search input — try in order:
   - `input[type="search"]`
   - `input[placeholder*="buscar" i]`
   - `input[placeholder*="search" i]`
   - `input[placeholder*="chercher" i]`
   - `form[action*="search"] input`
3. Fill with a known SKU, press Enter, observe the resulting URL
4. Record the URL pattern and use it for the rest of this run
5. If the input is inside a Shadow DOM custom element:
   ```js
   document.querySelector('custom-element-name').shadowRoot.querySelector('input')
   ```
6. If the site returns a CAPTCHA or JS challenge page after navigation → skip to Layer 3

---

## Layer 3 — Google Search via Firecrawl (preferred) or Playwright (fallback)

**Preferred method: Firecrawl POST** (see Tool Selection section above). Faster and parallelisable.

**Fallback: Playwright navigate** — only if Firecrawl is unavailable or returns empty markdown:
```
browser_navigate("https://www.google.com/search?q=site:{domain}+{search_term}&hl={lang}&gl={country}")
```

> ⚠️ WebFetch of Google does NOT work — returns a JavaScript challenge page. Use Firecrawl or Playwright only.

Prices and stock status appear directly in Google's rich snippets (no need to follow links).

**Search term priority (applies to both Firecrawl and Playwright):**
1. `{model_ref}` e.g. `Acer Aspire 15 A15-51M` — reliable, returns product pages with prices
2. `{model_ref}+{key_attribute}` e.g. `Acer SFG16-72 Core Ultra 9` — narrows to specific config
3. Quoted SKU e.g. `"NX.KSHEB.005"` — **often returns 0 results**; try unquoted or skip

**Extracting price from Firecrawl markdown:**
- Prices appear as `X.XXX,XX €` or `X.XXX € · En stock` in the markdown text
- Stock status follows the price: `En stock`, `Agotado`, `Disponible`, `Disponibile`
- Product URL is in the markdown link preceding the price line

**Extracting price from Playwright snapshot:**
- In the accessibility tree: `generic` nodes containing `X.XXX,XX €` near stock status text
- Product URL is in the `link` element of the result heading

**Staleness:** Google index typically reflects product pages within 1–7 days.
If snippet has no price → product URL found but price not indexed → navigate to page (if not Cloudflare-blocked).

If Google returns zero results → product not in Google's index for that domain → report Not listed.

**Broad name search first:** Before site-specific searches, run a broad `{model_ref}` Google search to see which competitors have the product indexed. If only 0–2 results appear, the product is niche/exclusive and further site searches will mostly return Not listed.

**Acer GP/HP prefix variants:** Acer docking accessories appear as both `GP.DSCAB.xxx` and `HP.DSCAB.xxx` for the same physical product across different markets. Always search both prefixes:
```
"GP.DSCAB.015" OR "HP.DSCAB.015"
```

---

## 1. Amazon — All Markets (Confirmed Working)

Amazon uses identical URL patterns and selectors across all country domains.
Use the domain that matches the target market.

**⚠️ Geo-lock — Playwright browser is geolocated to Indonesia.**
Direct Playwright navigation to any amazon.{eu-domain} will show prices in IDR, not EUR.
Do NOT use Layer 1 or Layer 2 for Amazon when running from this environment.
Use **Layer 3 (Firecrawl → Google rich snippets)** exclusively to get EUR prices.

The confirmed Layer 3 query pattern for Amazon across all EU domains:
```
Firecrawl POST: https://www.google.com/search?q=%22{asin}%22+%22€%22&hl=en&gl=de
```
Google snippets for Amazon.de reliably show:
- Current EUR price with "In stock" badge
- "Was:" (previous median price)
- Number of offers with lowest marketplace price ("X offers from €Y")

**Country → domain mapping (aligned with Acer store locales):**

| Market | Domain | Acer locale(s) |
|--------|--------|----------------|
| Spain | amazon.es | es-es |
| France | amazon.fr | fr-fr, fr-be |
| Germany | amazon.de | de-de |
| Italy | amazon.it | it-it |
| Netherlands | amazon.nl | nl-nl, nl-be |
| Poland | amazon.pl | pl-pl |
| Ireland / UK | amazon.co.uk | en-ie |
| Sweden / Nordics | amazon.se | sv-se, fi-fi, da-dk, no-no |

**Layer 1**

Search URLs (try in order):
- `https://www.{domain}/s?k={sku}`
- `https://www.{domain}/s?k={brand}+{model_ref}`

Wait for: `.s-result-item[data-asin]`

Extract from listing page:
```js
[...document.querySelectorAll('.s-result-item[data-asin]')].map(el => ({
  asin: el.dataset.asin,
  title: el.querySelector('[data-cy="title-recipe"] span')?.textContent?.trim()
       || el.querySelector('h2 a span')?.textContent?.trim(),
  price: el.querySelector('.a-price .a-offscreen')?.textContent?.trim(),
  url: el.querySelector('h2 a')?.href
})).filter(r => r.asin && r.title)
```

**Note:** Amazon A/B tests layouts frequently. `[data-cy="title-recipe"] span` is the confirmed working
selector (2025). Fall back to `h2 a span` if it returns empty.

If SKU found in title → navigate to `https://www.{domain}/dp/{asin}` for exact price.

Product page price selectors (in order of preference):
- `#corePriceDisplay_desktop_feature_div .a-offscreen`
- `#priceblock_ourprice`
- `.a-price[data-a-color="price"] .a-offscreen`

**Known results for amazon.es — Acer Swift SFG16-72 Core Ultra 9 185H 32GB:**
- ASIN: `B0D42BYTN3`
- URL: `https://www.amazon.es/Acer-Swift-SFG16-72-Ordenador-Processor/dp/B0D42BYTN3`
- SKU search (`NX.KSHEB.005`) returns 0 results — use model ref search instead

---

## 2. Worten.es — Playwright Layer 1 Only (Spain)

> ⚠️ **Firecrawl blocked** — Cookiebot wall returns a 467-char cookie banner with no product content. Use Playwright only.

**Layer 1 (Playwright)**

**Critical: Accept cookie consent before any search.**
Wait for Cookiebot banner and click: `#CybotCookiebotDialogBodyButtonAccept`

Search URLs (try in order):
- `https://www.worten.es/search?query={short_term}` — e.g. `Acer+SFG16`
- `https://www.worten.es/search?query={model_ref}` — e.g. `Acer+Swift+Go+16`

**Important:** Hyphenated model refs (e.g. `SFG16-72`) and queries with 3+ specific words trigger
a backend error: `[SEARCH-PRODUCT] Error returned from searc...`. Use short prefixes instead:
- `Acer SFG16` — works reliably
- `Acer Swift SFG16-72` — may fail
- Always URL-encode spaces as `+`

Wait for: `article`

Extract from listing:
```js
[...document.querySelectorAll('article')].map(c => ({
  title: c.querySelector('h3')?.textContent?.trim(),
  price: c.querySelector('span[aria-label^="Precio"]')?.getAttribute('aria-label')
          ?.replace('Precio ', ''),
  oldPrice: c.querySelector('s.price__scratched-price')?.textContent?.trim(),
  status: c.querySelector('[role="note"]')?.textContent?.trim(), // "Agotado"
  url: c.querySelector('a[href*="/productos/"]')?.href
})).filter(r => r.title && r.price)
```

**Known result:** SFG16-72 Core Ultra 9 185H 32GB — €1,399 (Agotado on worten.es mainland)
Also available on `canarias.worten.es` at same price (En stock) — different domain.

---

## 3. El Corte Inglés — Firecrawl Layer 3 (Spain)

> ✅ **Firecrawl confirmed working** — `site:elcorteingles.es Acer Aspire 15 A15-51M` returns product page with price in Google snippet (849,00 € · En stock). Simpler than Layer 1 direct scraping.

**Layer 3 (Firecrawl — preferred):**
```
Firecrawl POST: https://www.google.com/search?q=site:elcorteingles.es+{model_name}&hl=es&gl=es
```
e.g. `site:elcorteingles.es+Acer+Aspire+15+A15-51M`

Prices appear in markdown as `849,00 € · En stock · Entrega sin coste adicional`.

**Layer 1 (Playwright — fallback if Firecrawl empty):**

**Step 1: Accept cookies**
Navigate to `https://www.elcorteingles.es/electronica/`
Click: `#onetrust-accept-btn-handler`

**Step 2: Search via URL** (more reliable than form):
```
https://www.elcorteingles.es/search-nwx/?ss={query}&stype=text_box
```

Wait for: `article`

Extract from results:
```js
[...document.querySelectorAll('article')].map(card => ({
  title: card.querySelector('h2')?.textContent?.trim(),
  price: card.querySelector('span[aria-label="Precio de venta"]')?.textContent?.trim(),
  oldPrice: card.querySelector('span[aria-label="Precio original"]')?.textContent?.trim(),
  url: card.querySelector('a[href*="/electronica/"]')?.href
})).filter(r => r.title)
```

**Note:** ECI direct URL returns "No results" for exact SKUs (e.g. NX.KSHEB.005). Use product name search. Attribute scan required — ECI shows multiple Acer variants at different specs.

---

## 4. Boulanger — Firecrawl Layer 3 Only (France)

> ✅ **Firecrawl confirmed working** — `site:boulanger.com Acer Aspire 15 A15-51M` returns 899,99 € with stock status. Direct site scraping remains impossible.

**Do not attempt Playwright or Firecrawl for direct site search.** The `BL-SEARCH` Shadow DOM component refuses to fire Algolia calls in headless mode. All `/recherche/*` URL patterns return 404.

**Confirmed dead ends (do not retry):**
- Shadow DOM input typing — input value updates but no API call fires
- All `/recherche/*` URL patterns → 404
- `/api/search` → 404
- Native keyboard events (Enter, form submit) → no effect

**Layer 3 (Firecrawl — preferred):**
```
Firecrawl POST: https://www.google.com/search?q=site:boulanger.com+{model_name}&hl=fr&gl=fr
```
e.g. `site:boulanger.com+Acer+Aspire+15+A15-51M`

> ⚠️ **Use name-based queries only.** Quoted SKU queries (`"NX.KSHEB.005"`) return 0 results. Product name (e.g. `Acer Aspire 15 A15-51M`) reliably returns results.

**Layer 3 (Playwright — fallback):**
```
browser_navigate("https://www.google.com/search?q=site:boulanger.com+{model_name}&hl=fr&gl=fr")
```

---

## 5. Darty — Firecrawl Layer 3 Only (France)

> ✅ **Firecrawl confirmed working** — `site:darty.com Acer Aspire 15 A15-51M` returns prices (979,00 € and 1 265,68 €) with stock status. Direct site scraping remains blocked.

**Do not attempt Playwright or Firecrawl for direct site.** Darty uses Cloudflare bot/fingerprint detection.

**Layer 3 (Firecrawl — preferred):**
```
Firecrawl POST: https://www.google.com/search?q=site:darty.com+{model_name}&hl=fr&gl=fr
```
e.g. `site:darty.com+Acer+Aspire+15+A15-51M`

**Layer 3 (Playwright — fallback):**
```
browser_navigate("https://www.google.com/search?q=site:darty.com+{model_name}&hl=fr&gl=fr")
```

Product URL pattern (from Google snippets):
```
https://www.darty.com/nav/achat/ref/{product-id}.html
```

**Known result:** Darty carries Aspire 15 A15-51M (i9/32GB) at ~979–1265 €.
SFG16-72 Core Ultra 9/32GB: only lower-spec variant (Core Ultra 7, 16GB) indexed on darty.com.
Attribute-scan results carefully before reporting a price.

---

## 6. JoyBuy — Confirmed Working (France)

**Site:** `https://www.joybuy.fr` (France domain only — no .es)

**Layer 1**

**Cookie consent:** Joybuy shows its own privacy banner on first visit.
Click: button with text "Accepter tout".
A country/language tooltip may appear after — dismiss with the "Compris" button.

**No country selector modal** — France locale is auto-detected based on domain.

Search URL (confirmed working):
```
https://www.joybuy.fr/s?k={query}
```

Wait for: `[class*="product_card"]` or the "Aucun résultat" empty state

Extract from listing:
```js
[...document.querySelectorAll('[class*="product_card"]')].map(card => ({
  url: card.querySelector('a[href*="/dp/"]')?.href,
  title: card.querySelector('img[alt]')?.alt,
  priceBlock: card.querySelector('[class*="price"]')?.textContent?.trim()
  // priceBlock format: "59,99 €79,99 €25% de réduction" — parse with regex
})).filter(r => r.url)
```

Product page URL pattern: `https://www.joybuy.fr/dp/{product-slug}/{product-id}`

**Expectation:** Acer Swift laptops are not stocked on JoyBuy.fr.
Only Acer monitors/displays appear. "Not listed" is the expected and valid outcome.

**Layer 3:** `browser_navigate("https://www.google.com/search?q=site:joybuy.fr+{search_term}&hl=fr&gl=fr")`

---

## 7. FNAC — Firecrawl Layer 3 Only (France / Spain)

> ⚠️ **fnac.es returns 0 results** for both Aspire 15 and SFG16-72 (tested with both SKU queries and broad name queries). Skip fnac.es unless the product is confirmed listed there.

**Do not attempt Playwright or Firecrawl for direct site.** FNAC returns 403 — Cloudflare bot detection.

**Layer 3 (Firecrawl — preferred):**
```
# Spanish domain
Firecrawl POST: https://www.google.com/search?q=site:fnac.es+{model_name}&hl=es&gl=es

# French domain
Firecrawl POST: https://www.google.com/search?q=site:fnac.com+{model_name}&hl=fr&gl=fr
```

**Layer 3 (Playwright — fallback):**
```
browser_navigate("https://www.google.com/search?q=site:fnac.com+{model_name}&hl=fr&gl=fr")
```

**Known results:**
- `site:fnac.es Acer Aspire 15 A15-51M` → 0 results (Firecrawl confirmed). Report Not listed.
- `site:fnac.es Acer Swift Go 16 SFG16-72` → 0 results (Firecrawl confirmed). Report Not listed.
- `site:fnac.com` (French domain) may have results — test separately per product.

---

## 8. PC Componentes — Firecrawl Layer 3 Only (Spain)

> ✅ **Firecrawl confirmed working** — SKU query `site:pccomponentes.com NX.KSHEB.005` returned 1349,00 € with full spec confirmation. SKU query works here (unlike other competitors).

**Do not attempt Playwright or Firecrawl for direct site.** Cloudflare Bot Management blocks headless browsers.

**Layer 3 (Firecrawl — preferred):**
```
Firecrawl POST: https://www.google.com/search?q=site:pccomponentes.com+{sku_or_model_name}&hl=es&gl=es
```
PC Componentes has good schema markup — price and stock status appear directly in Google snippets.

**Layer 3 (Playwright — fallback):**
```
browser_navigate("https://www.google.com/search?q=site:pccomponentes.com+{sku_or_model_name}&hl=es&gl=es")
```

**Known result:** Acer Swift Go 16 OLED SFG16-72 Core Ultra 9 185H/32GB/1TB
- URL: `https://www.pccomponentes.com/portatil-acer-swift-go-16-oled-sfg16-72-intel-evo-core-ultra-9-185h-32gb-1tb-ssd-16`
- Price: **€1,349** · Status: **Agotado**
- Snippet confirms specs: Core Ultra 9 185H, 32GB DDR5, 1TB NVMe PCIe 4.0

---

## 9. MediaMarkt — Firecrawl Layer 3 Only (Spain + multi-country)

> ✅ **Firecrawl confirmed working** — `site:mediamarkt.es "NX.JCJEB.005" OR "Acer Aspire 15"` returns prices (990,94 € · En stock). Note: results may include refurbished units — check title for "Reacondicionado".

Cloudflare Bot Management blocks direct site scraping. Google snippets work.

**Layer 3 (Firecrawl — preferred, Spain):**
```
Firecrawl POST: https://www.google.com/search?q=site:mediamarkt.es+{model_name}&hl=es&gl=es
```

**Other country domains** (same Firecrawl pattern, swap domain + hl/gl):
- `mediamarkt.de` → Germany (`hl=de&gl=de`)
- `mediamarkt.it` → Italy (`hl=it&gl=it`)
- `mediamarkt.nl` → Netherlands (`hl=nl&gl=nl`)
- `mediamarkt.pl` → Poland (`hl=pl&gl=pl`)
- `mediamarkt.se` → Sweden (`hl=sv&gl=se`)

**Layer 3 (Playwright — fallback):**
```
browser_navigate("https://www.google.com/search?q=site:mediamarkt.es+{model_name}&hl=es&gl=es")
```

**Known result (Spain):** Acer Swift Go 16 SFG16-72 Core Ultra 9 185H/32GB
- Only **refurbished** ("Reacondicionado") units indexed — no new stock
- Model: SFG16-72-91WW
- Seminuevo Bueno: **€899.25**, En stock
- Seminuevo Muy bueno: **€1,019.15**, En stock
- URL pattern: `/es/product/_reacondicionado-seminuevo-{grade}-portatil-{slug}-{id}.html`
- Flag refurbished status in output — confidence is Verify for new-unit price comparison

---

## 10. Currys Ireland — Firecrawl Layer 1 (Ireland ONLY)

> ⚠️ **Use currys.ie (EUR) only. Do NOT use currys.co.uk (GBP) — we do not ship to UK.**

**Confirmed working via Firecrawl scrape.** Name search returns full product cards with € prices and direct product URLs.

**⚠️ SKU search returns empty** — Currys does not index Acer SKUs. Always search by name or model ref.

Search URL:
```
https://www.currys.ie/search?q={model_ref}
```
e.g. `https://www.currys.ie/search?q=Acer+Aspire+15+A15-51M`

Price format: `€619.00` with optional "Was €X.XX (from date to date)" for promotions.
Product URL pattern: `https://www.currys.ie/products/{product-slug}.html`

---

## 11. Cdiscount — Firecrawl Layer 1 (France)

**Confirmed working via Firecrawl scrape.** Returns category filters + product listings with €prices.

Search URL:
```
https://www.cdiscount.com/search/10/{url-encoded-query}.html
```
e.g. `https://www.cdiscount.com/search/10/acer+aspire+14+oled.html`

Returns: category counts (e.g. "Informatique(14)"), product cards with prices like `399,99 €`, product URLs.
Price format: `399,99 €` (French decimal comma).

---

## 12. Allegro — Firecrawl Layer 1 (Poland)

**Confirmed working via Firecrawl scrape.** Returns full product listing with PLN prices.

Search URL:
```
https://allegro.pl/listing?string={query}
```
e.g. `https://allegro.pl/listing?string=NX.J02EK.003+Acer` or `https://allegro.pl/listing?string=Acer+Aspire+17+A17-51M`

Price format: `2699,00zł` (Polish comma decimal, zł suffix).
Returns 100K+ chars with many product cards. Attribute-scan required — search returns mixed results.

---

## 13. Elgiganten — Firecrawl Layer 1 (Sweden / Denmark)

**Confirmed working via Firecrawl scrape.** Returns full product listing with SEK prices.

Search URL:
```
https://www.elgiganten.se/search?SearchTerm={query}
```
e.g. `https://www.elgiganten.se/search?SearchTerm=Acer+Aspire+15+A15-51M`

For Denmark: `https://www.elgiganten.dk/search?SearchTerm={query}`

Price format: `4490.-` (SEK, dot-dash suffix). Promo shows two prices: `4490.-3592.-` (original then sale).
Returns 60K+ chars. Attribute-scan required — results are mixed (all brands).

---

## Sites confirmed NOT accessible via Firecrawl

| Site | Reason |
|------|--------|
| Bol.com | Akamai WAF — explicit IP block message |
| Coolblue | Cookie wall blocks JS rendering — no product content |
| Unieuro | Heavy SPA — Firecrawl only returns 3.8K homepage shell |
| Notebooksbilliger | Consistent timeout (>40s) on every attempt |
| Alternate.de | Search URL pattern unknown — all tried patterns return 404 |
| Media Expert | SPA — search page returns nav only (8K); product JS never executes |

For these sites, use **Layer 3 (Google rich snippets via Playwright)** as fallback.
