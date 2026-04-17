# Campaign Templates

Reusable Google Ads campaign templates for Wizhard.

## Product Search Test

Use for first validation of a product-specific Search campaign.

```yaml
type: Search
goal: Website Traffic
bidding:
  strategy: Maximize Clicks
budget:
  type: Daily
  amount: 1 EUR to 5 EUR
network:
  search_partners: false
  display_network: false
audience:
  mode: Observation
keywords:
  match_types:
    - exact product name
    - phrase product name
    - phrase category intent
status:
  initial: paused
```

## Product Launch

Use for newly listed products with stock and complete product pages.

```yaml
type: Search
goal: Sales
bidding:
  strategy: Maximize Conversions
budget:
  type: Daily
network:
  search_partners: false
  display_network: false
tracking:
  conversion_action: Purchase
```

## High-Stock Clearance

Use when inventory needs to move.

```yaml
type: Search
goal: Sales
bidding:
  strategy: Maximize Clicks or Maximize Conversions
budget:
  type: Daily
keywords:
  include:
    - product name
    - discount intent
    - buy intent
copy:
  include_stock_or_offer: true
```

## Brand Search

Use for protecting branded demand.

```yaml
type: Search
goal: Website Traffic or Sales
keywords:
  include:
    - komputerzz
    - komputerzz electronics
    - komputerzz crypto electronics
budget:
  type: Daily
network:
  search_partners: false
```

## Retargeting Placeholder

Do not launch until audience and consent tracking are verified.

```yaml
type: Display or Performance Max
status: blocked
requirements:
  - verified remarketing audience
  - consent mode reviewed
  - conversion tracking verified
```

