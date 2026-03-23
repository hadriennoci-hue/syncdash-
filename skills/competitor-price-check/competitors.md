# Competitor Protocols

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

## Layer 3 — Google Search via Playwright

**Important:** WebFetch of Google does NOT work — it returns a JavaScript challenge page with no results.
Use Playwright to navigate to Google instead:

```
browser_navigate("https://www.google.com/search?q=site:{domain}+{search_term}&hl={lang}&gl={country}")
```

Prices and stock status appear directly in Google's rich snippets (no need to follow links).

**Search term priority:**
1. `{sku}` — SKU visible in snippet title or description → price is reliable
2. `{model_ref}+{key_attribute}` e.g. `SFG16-72+Core+Ultra+9` — check snippet specs before accepting price
3. Product name alone → insufficient — only use if full spec attributes appear in snippet

**Extracting price and status from snapshot:**
- Rich snippets show price, old price, and status (En stock / Agotado / En stock / Disponibile) directly
- In the accessibility tree: `generic` nodes containing `X.XXX,XX €` near stock status text
- Product URL is in the `link` element of the result heading

**Staleness:** Google index typically reflects product pages within 1–7 days.
If snippet has no price → product URL found but price not indexed → navigate to page (if not Cloudflare-blocked).

If Google returns zero results → product not in Google's index for that domain → report Not listed.

**Multi-site efficiency:** Combine multiple `site:` operators in a single query to cover all Layer-3 competitors at once:
```
browser_navigate("https://www.google.com/search?q=site:worten.es+OR+site:elcorteingles.es+OR+site:pccomponentes.com+OR+site:mediamarkt.es+%22{sku}%22&hl=en&gl=es")
```
This is significantly faster than separate queries per competitor.

**Broad SKU search first:** Before site-specific searches, run a broad `"{sku}"` Google search to immediately see which competitors have the product indexed. If only 0–2 results appear, the product is niche/exclusive and further site searches will mostly return Not listed.

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
Use **Layer 3 (Google rich snippets)** exclusively to get EUR prices.

The confirmed Layer 3 query pattern for Amazon across all EU domains:
```
browser_navigate("https://www.google.com/search?q=%22{asin}%22+%22€%22&hl=en&gl=de")
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

## 2. Worten.es — Confirmed Working (Spain)

**Layer 1**

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

## 3. El Corte Inglés — Confirmed Working (Spain)

**Layer 1**

**Step 1: Accept cookies**
Navigate to `https://www.elcorteingles.es/electronica/`
Click: `#onetrust-accept-btn-handler`

**Step 2: Open search**
Click: `button.search-link` (this reveals the search input)

**Step 3: Search**
The confirmed search URL pattern (discovered live — `?s=` and `?search=` do NOT work):
```
https://www.elcorteingles.es/search-nwx/?ss={query}&stype=text_box
```

Navigate directly to this URL instead of using the form (more reliable).

Wait for: `article`

Extract from results:
```js
[...document.querySelectorAll('article')].map(card => ({
  title: card.querySelector('h2')?.textContent?.trim(),
  price: card.querySelector('span[aria-label="Precio de venta"]')?.textContent?.trim(),
  oldPrice: card.querySelector('span[aria-label="Precio original"]')?.textContent?.trim(),
  discount: card.querySelector('span[aria-label="Descuento"]')?.textContent?.trim(),
  url: card.querySelector('a[href*="/electronica/"]')?.href
})).filter(r => r.title)
```

**Note:** SFG16-72 Core Ultra 9/32GB not found in top ECI results during live test.
ECI primarily shows the lower-spec variant (Ultra 7/16GB at €899). Attribute scan required.

**Layer 3:** `site:elcorteingles.es` via Playwright+Google

---

## 4. Boulanger — Layer 3 Only (France)

**Do not attempt Playwright for search.** The `BL-SEARCH` Shadow DOM component is accessible
(input found at `BL-SEARCH > shadowRoot > input.search-input`) but the Lit-based web component
refuses to fire internal Algolia search API calls in headless mode. The form action is `#` (no URL).
All URL-based patterns (`/recherche/`, `/recherche?q=`, `/api/search`) return 404.

**Confirmed dead ends (do not retry):**
- Shadow DOM input typing — input value updates but no API call fires
- All `/recherche/*` URL patterns → 404
- `/api/search` → 404
- Native keyboard events (Enter, form submit) → no effect

**Layer 3 only:**
```
browser_navigate("https://www.google.com/search?q=site:boulanger.com+{search_term}&hl=fr&gl=fr")
```

---

## 5. Darty — Layer 3 Only (France)

**Do not attempt Playwright.** Darty uses Cloudflare bot/fingerprint detection — the site loads fine
in a real browser but returns a challenge/block to headless Playwright regardless of IP or VPN.

**Layer 3 only:**
```
browser_navigate("https://www.google.com/search?q=site:darty.com+{search_term}&hl=fr&gl=fr")
```

Product URL pattern (from Google snippets):
```
https://www.darty.com/nav/achat/informatique/ordinateur_portable-portable/portable/{product-id}.html
```

**Known result:** Darty carries SFG16-72 but only the **lower-spec variant** (Core Ultra 7 155U, 16GB).
Core Ultra 9 / 32GB config: zero results in Google's index on darty.com.
When searching, attribute-scan any results carefully before reporting a price.

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

## 7. FNAC — Layer 3 Only (France / Spain)

**Do not attempt Playwright.** FNAC returns 403 on every request including the homepage — Cloudflare
bot/fingerprint detection. Site loads fine in a real browser but blocks headless automation.

**Layer 3 only:**
```
# Spanish domain
browser_navigate("https://www.google.com/search?q=site:fnac.es+{search_term}&hl=es&gl=es")

# French domain
browser_navigate("https://www.google.com/search?q=site:fnac.com+{search_term}&hl=fr&gl=fr")
```

**Known results:**
- `site:fnac.es Acer SFG16-72` → zero Google results. Product not indexed on fnac.es.
- `site:fnac.com` may have results for other markets.

---

## 8. PC Componentes — Layer 3 Only (Spain)

**Do not attempt Playwright.** Cloudflare Bot Management blocks headless browsers before any content loads.

**Layer 3 only:**
```
browser_navigate("https://www.google.com/search?q=site:pccomponentes.com+{search_term}&hl=es&gl=es")
```

PC Componentes has good schema markup — price and stock status appear directly in Google snippets.

**Known result:** Acer Swift Go 16 OLED SFG16-72 Core Ultra 9 185H/32GB/1TB
- URL: `https://www.pccomponentes.com/portatil-acer-swift-go-16-oled-sfg16-72-intel-evo-core-ultra-9-185h-32gb-1tb-ssd-16`
- Price: **€1,349** · Status: **Agotado**
- Snippet confirms specs: Core Ultra 9 185H, 32GB DDR5, 1TB NVMe PCIe 4.0

---

## 9. MediaMarkt — Layer 3 Only (Spain + multi-country)

Cloudflare Bot Management blocks Playwright. Google snippets work.

**Layer 3 (Spain):**
```
browser_navigate("https://www.google.com/search?q=site:mediamarkt.es+{search_term}&hl=es&gl=es")
```

**Other country domains** (same pattern, swap domain + hl/gl):
- `mediamarkt.de` → Germany (`hl=de&gl=de`)
- `mediamarkt.it` → Italy (`hl=it&gl=it`)
- `mediamarkt.nl` → Netherlands (`hl=nl&gl=nl`)
- `mediamarkt.pl` → Poland (`hl=pl&gl=pl`)
- `mediamarkt.se` → Sweden (`hl=sv&gl=se`)

**Known result (Spain):** Acer Swift Go 16 SFG16-72 Core Ultra 9 185H/32GB
- Only **refurbished** ("Reacondicionado") units indexed — no new stock
- Model: SFG16-72-91WW
- Seminuevo Bueno: **€899.25**, En stock
- Seminuevo Muy bueno: **€1,019.15**, En stock
- URL pattern: `/es/product/_reacondicionado-seminuevo-{grade}-portatil-{slug}-{id}.html`
- Flag refurbished status in output — confidence is Verify for new-unit price comparison
