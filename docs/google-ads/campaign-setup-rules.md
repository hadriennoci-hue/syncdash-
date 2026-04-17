# Campaign Setup Rules

Rules for creating Google Ads campaigns for Wizhard.

## Required Before Scheduling

- Product SKU exists in D1.
- Destination URL is public and points to the correct product or collection.
- Product is in stock or intentionally being tested despite low stock.
- Campaign has a clear objective.
- Budget is explicit.
- Tracking parameters are defined.
- Campaign has been reviewed before moving from `draft` to `approved`.

## Naming

Use descriptive names with channel, product/category, test marker when relevant, country or region, and budget if useful.

Example:

```text
Search_Mouse_Test_EU_1€
```

Suggested pattern:

```text
<Type>_<ProductOrCategory>_<TestOrIntent>_<Region>_<Budget>
```

## Destination Rules

- Product campaigns should point to a product page.
- Category campaigns should point to a collection/category page.
- Do not schedule a campaign with an empty or temporary destination URL.
- Use the final production storefront URL, not an admin or preview URL.

## Budget Rules

- Test campaigns may use very low daily budgets, such as 1 EUR/day.
- Production budgets must have an explicit owner and review cadence.
- Lifetime budgets must include an end date.
- Daily budgets without an end date need monitoring.

## Network Rules

For early tests:
- Search Network only.
- Search partners off unless intentionally testing reach.
- Display Network off unless building a display-specific campaign.

## Geo Rules

Use "people in or regularly in" the target location. Avoid "interested in" targeting unless the campaign is explicitly for international discovery.

## Language Rules

Use English when ad copy and landing pages are in English. Add local languages only when the landing page and ad copy are localized.

## Keyword Rules

- Include exact-match product terms.
- Include phrase-match product terms.
- Include category intent terms.
- Avoid broad match until conversion tracking and negative keywords are stable.
- Review search terms before increasing spend.

## Copy Rules

- Headlines should describe the product, brand, stock status, or main purchase reason.
- Descriptions should be plain text.
- Avoid claims that are not visible on the landing page.
- Avoid price claims unless price sync and sale timing are reliable.

## Tracking Rules

Until automated tracking is finalized:
- Use manual UTM conventions.
- Keep campaign names stable.
- Use purchase conversion action as the primary conversion once gtag is verified.

Suggested UTM pattern:

```text
utm_source=google&utm_medium=cpc&utm_campaign=<campaign_name>&utm_content=<ad_or_asset>&utm_term=<keyword>
```

