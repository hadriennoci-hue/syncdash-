# Performance Analysis

This document defines how Wizhard should analyze Google Ads performance.

## Primary Questions

- Is the campaign spending?
- Are impressions and clicks relevant?
- Are clicks converting into purchases?
- Is spend profitable after refunds and product economics?
- Which keywords, ads, products, countries, and devices are helping or hurting?

## Core Metrics

- Impressions
- Clicks
- CTR
- Spend
- CPC
- Conversions
- Conversion value
- CPA
- ROAS
- Orders from Wizhard sales data
- Net revenue after refunds
- Attribution confidence

## Google Conversions Vs Wizhard Orders

Google-reported conversions and Wizhard-attributed purchases are different views.

Google conversions:
- depend on conversion tag setup
- may use Google attribution windows
- may include modeled conversions

Wizhard orders:
- come from imported sales data
- can be tied to SKU, product, channel, and net revenue
- depend on UTM/GCLID capture

Reports must label which metric source is being used.

## Attribution Confidence

Suggested confidence levels:

- `0.95`: order matched by exact GCLID click.
- `0.70`: order matched by UTM campaign name to imported campaign.
- `0.35`: proxy match by SKU and time window.
- `0.00`: unattributed.

## Review Cadence

For test campaigns:
- check daily for spend and click quality
- do not optimize too aggressively on tiny budgets
- inspect search terms before increasing budget

For production campaigns:
- daily budget/spend check
- twice-weekly keyword and search term review
- weekly creative and landing page review
- weekly profitability review

## Decision Rules

Pause or revise when:
- spend occurs with no relevant clicks
- search terms are clearly irrelevant
- landing page is unavailable
- stock is unavailable
- CPC is too high for product economics
- repeated clicks produce no add-to-cart or purchase signal

Scale cautiously when:
- conversions are tracked correctly
- ROAS is positive or improving
- search terms are relevant
- product has enough stock
- landing page conversion rate is acceptable

## Segment Analysis

Analyze by:
- country
- device
- keyword
- ad group
- campaign
- creative/headline
- product SKU
- destination page

Future Wizhard reports should surface winners and losers using `ads_creative_daily_metrics`, `ads_segment_daily_metrics`, and `ads_campaign_kpi_daily`.

