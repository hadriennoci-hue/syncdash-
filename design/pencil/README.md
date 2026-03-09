# Wizhard — Design Index

Production-grade UI designs for the Wizhard dashboard. Each `.pen` file corresponds to a real route. Specs define data bindings, states, and responsive rules.

## Status Legend

| Status        | Meaning                                    |
|---------------|--------------------------------------------|
| `draft`       | In progress, not reviewed                  |
| `ready`       | Design complete, ready for dev handoff     |
| `implemented` | Shipped in code                            |

---

## Pages

Priority order: Dashboard → Ads → Social Media → remaining routes.

| Route                         | .pen file                               | Spec file                               | Status |
|-------------------------------|-----------------------------------------|-----------------------------------------|--------|
| `/`                           | pages/home.pen                          | specs/home.md                           | ready  |
| `/ads/pipeline`               | pages/ads-pipeline.pen                  | specs/ads-pipeline.md                   | draft  |
| `/ads/performance`            | pages/ads-performance.pen               | specs/ads-performance.md                | draft  |
| `/social-media/pipeline`      | pages/social-media-pipeline.pen         | specs/social-media-pipeline.md          | draft  |
| `/social-media/performance`   | pages/social-media-performance.pen      | specs/social-media-performance.md       | draft  |
| `/products`                   | pages/products.pen                      | specs/products.md                       | draft (currently redirected) |
| `/products/new`               | —                                       | —                                       | —      |
| `/products/[sku]`             | pages/product-detail.pen                | —                                       | draft  |
| `/products/[sku]/edit`        | —                                       | —                                       | —      |
| `/warehouses`                 | —                                       | specs/warehouses.md                     | draft  |
| `/warehouses/[id]`            | —                                       | —                                       | —      |
| `/channels`                   | —                                       | —                                       | —      |
| `/channels/[id]`              | —                                       | —                                       | —      |
| `/orders`                     | —                                       | —                                       | —      |
| `/orders/new`                 | —                                       | —                                       | —      |
| `/orders/[id]`                | —                                       | —                                       | —      |
| `/suppliers`                  | —                                       | —                                       | —      |
| `/suppliers/[id]`             | —                                       | —                                       | —      |
| `/tiktok`                     | —                                       | —                                       | —      |
| `/analyze`                    | —                                       | —                                       | —      |
| `/validate`                   | —                                       | —                                       | —      |
| `/sync`                       | —                                       | specs/sync.md                           | draft  |
| `/sync/logs`                  | —                                       | —                                       | —      |
| `/settings`                   | —                                       | —                                       | —      |
| `/settings/import`            | —                                       | —                                       | —      |
| `/settings/routing`           | —                                       | —                                       | —      |
| `/mappings`                   | —                                       | —                                       | —      |

---

## Navigation structure (sidebar)

```
Dashboard            /
Warehouses           /warehouses
Sale Channels        /channels
Orders               /orders
Suppliers            /suppliers

SOCIAL MEDIA  (section header)
  Pipeline           /social-media/pipeline
  Performance        /social-media/performance

ADS  (section header)
  Pipeline           /ads/pipeline
  Performance        /ads/performance

TikTok               /tiktok
Analysis             /analyze
Validate             /validate
Sync Logs            /sync
Settings             /settings
```

---

## Components

| Component               | .pen file                             | Used in                                  |
|-------------------------|---------------------------------------|------------------------------------------|
| Page header             | components/page-header.pen            | all pages                                |
| Filter bar              | components/filter-bar.pen             | /products, /orders, /ads/pipeline        |
| Data table              | components/data-table.pen             | /products, /orders, /ads/pipeline        |
| Status badge / pill     | components/status-badge.pen           | /products, /channels, /ads, /social      |
| Metric card             | components/metric-card.pen            | /, /ads, /social-media                   |
| Channel node card       | components/channel-node.pen           | /                                        |
| Warehouse node card     | components/warehouse-node.pen         | /                                        |

---

## Design rules

Current state note: these are target visual rules for Pencil design work; implementation may still differ.

- All layouts implement 4 states: `loading`, `empty`, `error`, `success`
- Unavailable optional metrics show `—`, never `0` or fabricated values
- Font families: **Playfair Display** for headings, **Space Mono** for data/labels
- Color system: `#2563EB` primary, `#059669` positive, `#F59E0B` warning, `#DC2626` negative
- Sidebar: dark `#111827` background, active item `#2563EB`
- Cards: `#FFFFFF` surface, `1px #E5E7EB` border, `10px` radius
