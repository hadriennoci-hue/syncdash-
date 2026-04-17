# Attribution

This document explains how Wizhard connects Google Ads traffic to sales.

## Data Sources

Google Ads:
- campaigns
- ad groups
- click views
- campaign metrics

Storefront and sales channels:
- landing URLs
- referring URLs
- order metadata
- UTM fields
- `gclid`
- order and line item data

## Main Tables

- `raw_google_ads_campaigns`
- `raw_google_ads_ad_groups`
- `raw_google_ads_click_views`
- `google_ads_campaigns`
- `google_ads_ad_groups`
- `sales_order_marketing`
- `sales_order_attribution`
- `sales_marketing_consolidated`
- `ads_campaign_daily_metrics`
- `shopify_sku_daily_metrics`
- `ads_campaign_kpi_daily`

## Attribution Flow

1. Google Ads import pulls campaigns, ad groups, and click views.
2. Sales import extracts marketing signals from order payloads.
3. Wizhard stores UTM and click IDs in `sales_order_marketing`.
4. Wizhard attributes each order in `sales_order_attribution`.
5. Reporting reads consolidated rows and KPI tables.

## Matching Models

### Last GCLID Click

If an order contains `gclid`, Wizhard searches imported Google click views and matches the latest click before order time.

Model:

```text
last_gclid_click
```

Confidence:

```text
0.95
```

### UTM Campaign Name

If no GCLID is available, Wizhard may match `utm_campaign` to an imported Google campaign name.

Model:

```text
utm_campaign_name
```

Confidence:

```text
0.70 if campaign found
0.35 if only a weak campaign signal exists
```

### SKU Time Window Proxy

For pipeline campaigns tied to a product SKU, Wizhard can compare campaign timing and SKU sales.

Model:

```text
sku_time_window_proxy
```

Confidence:

```text
0.35
```

## UTM Requirements

Campaign URLs should include:

```text
utm_source=google
utm_medium=cpc
utm_campaign=<campaign_name>
utm_content=<ad_or_asset>
utm_term=<keyword>
```

Use stable campaign names. Renaming campaigns after launch makes attribution harder.

## Known Gaps

- Google Ads import is not yet passing developer token validation.
- Storefront conversion tracking must be verified.
- Manual campaigns must be reconciled into Wizhard records.
- GCLID capture must be tested end to end from click to order.

