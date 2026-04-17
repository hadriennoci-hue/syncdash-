# Test Campaigns

Manual and early Google Ads campaigns are recorded here until Wizhard can fully import, reconcile, and publish them.

## Search_Mouse_Test_EU_1€

Status:
- Manually started in Google Ads.
- Mostly a test.
- Wizhard is not connected to Google Ads input/output yet.
- Should be reconciled into Wizhard later by customer ID, campaign name, final URL, and product SKU.

```yaml
campaign:
  name: Search_Mouse_Test_EU_1€
  type: Search
  goal: Website Traffic (temporary)
  conversion_goal: Purchase (Achat)

bidding:
  strategy: Maximize Clicks
  target_cpa: null

budget:
  type: Daily
  amount: 1€ (test)

network:
  search_partners: false
  display_network: false

geo:
  locations:
    - France
    - Germany
    - Spain
    - Belgium
    - Ireland
  presence: People in or regularly in location

language:
  - English

audience:
  mode: Observation
  segments: none

schedule:
  start_date: 2026-04-16
  end_date: none
  ad_rotation: Optimize best performing

tracking:
  conversion_action: Purchase
  count: All
  attribution: Data-driven
  value: Dynamic (per conversion)
  method: Manual gtag event

ad_group:
  name: Gaming Mouse

keywords:
  - [predator cestus 333]
  - "predator cestus 333 mouse"
  - "acer predator mouse"
  - "acer gaming mouse"
  - "wired gaming mouse rgb"
  - "gaming mouse 16000 dpi"
  - "gaming mouse high dpi"

ad:
  final_url: https://komputerzz.com/product/predator-cestus-333-gaming-mouse
  path:
    - gaming
    - mouse

  headlines:
    - Gaming Mouse
    - Wired Optical Gaming Mouse
    - Cestus Predator 333 Mouse
    - In Stock SKU: GP.MCE11.03

  descriptions:
    - Predator Cestus 333 Gaming Mouse | Komputerzz
    - RGB lighting
    - Wired optical gaming mouse. PixArt 3389 sensor

  extensions:
    sitelinks:
      - name: Gaming Accessories
        url: https://komputerzz.com/
```

## Review Notes

This is an acceptable early smoke test because:
- budget is very low
- Search partners are off
- Display Network is off
- audience mode is Observation
- keywords are product/category focused

Risks:
- final URL should be verified against the live product URL structure
- conversion tracking must be verified before interpreting CPA/ROAS
- English-only copy across France, Germany, Spain, Belgium, and Ireland may limit relevance
- broad category phrases may need negative keywords after search terms appear

Suggested first checks:
- campaign serves
- clicks are relevant
- conversion action fires on purchase
- landing page is available
- product SKU `GP.MCE11.03` exists in Wizhard and maps to the landing page
- search terms are reviewed before increasing budget

