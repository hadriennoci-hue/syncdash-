# Translation Restart After Firecrawl Reset

Date to resume: `2026-05-23`

Context:
- Firecrawl credits were exhausted during full locale-source discovery.
- Do not trust the failed full-discovery counts as real Acer coverage because many rows are `402` / `429`, not true misses.
- Existing reports:
  - `reports/translation-coverage-2026-04-27T14-42-27-101Z.{md,json}`
  - `reports/translation-source-discovery-2026-04-27T15-05-49-214Z.{md,json}`

What to do after credits reset:
1. Re-run full locale URL discovery for all active products.
2. For each SKU and locale (`fr/de/es/it`), save whether an Acer locale URL exists.
3. Only after discovery, extract localized `title`, plain-text `description`, and `metaDescription` from found Acer URLs.
4. For locales with no valid Acer URL, use AI fallback from the English content of that same SKU only.
5. Write translations into Wizhard first.
6. Review noisy rows, then push approved batches to `shopify_komputerzz`.

Rules:
- Discovery first, extraction second, AI fallback third.
- Do not let AI invent missing specs or marketing claims.
- Descriptions must stay plain text in Wizhard.
- Shopify formatting stays connector-side only.

Commands to use:
```bash
npm run translations:report -- --status=active --concurrency=8
npm run translations:discover-sources -- --status=active --concurrency=5
```

Likely follow-up implementation:
- Add persistence for discovered locale URLs per SKU/locale.
- Add a bulk importer that consumes discovered URLs first, then AI-fills only missing locale slots.
