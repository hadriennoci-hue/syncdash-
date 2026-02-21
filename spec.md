# Project Specification

## Overview

**Product Name:** SyncDash — Product Catalogue Sync Dashboard
**One-liner:** Internal tool to manage and synchronize a product catalogue across 3 e-commerce platforms (WooCommerce, Shopify ×2), 3 warehouses (Ireland, Poland, ACER Store), and a supplier/order tracking system — accessible by a human operator and by an external AI agent (Claude) via REST API.

**Problem Statement:** Managing 300+ products across multiple platforms, warehouses, and suppliers is error-prone and time-consuming. Descriptions diverge, images go missing, prices get out of sync, stock levels are unknown. SyncDash provides a single source of truth, deterministic push functions, daily automated stock sync, and a clean interface to keep everything aligned.

---

## Target Users

| Persona | Description | Primary Goal |
|---------|-------------|--------------|
| Store operator (human) | Solo operator managing platforms, warehouses, orders | Visualize catalogue state, push updates, track stock & orders |
| AI agent (Claude) | External Claude instance connecting via the SyncDash REST API | Import catalogues, detect inconsistencies, apply fixes with human confirmation |

---

## Authentication

**Method:** Cloudflare Access (SSO)
- No custom auth in the application
- Access controlled at the Cloudflare level (Google SSO or other identity provider)
- Bearer token authentication on all `/api/*` routes (same token used by both the web UI and the AI agent)

---

## Source of Truth — Two Phases

### Phase A — Initial import (one-time)
Komputerzz.com is the starting point. Its full catalogue (~300 products, variants, images, collections, metafields) is imported into SyncDash D1 via `POST /api/import/shopify_komputerzz`. After this import, SyncDash D1 becomes the master.

### Phase B — Ongoing (permanent mode)
**SyncDash D1 is the master catalogue.** New products are created directly in SyncDash and pushed to the channels. Komputerzz is treated as a channel like the others — it receives pushes from SyncDash, it is no longer the source.

```
Phase A (one-time):   Komputerzz ──import──► SyncDash D1
Phase B (permanent):  SyncDash D1 ──push───► Komputerzz
                      SyncDash D1 ──push───► Coincart
                      SyncDash D1 ──push───► TikTok Shop
```

The import function remains available for re-import / reconciliation, but is no longer the primary creation workflow after Phase A.

---

## Sales Channels

| ID | Display Name | Platform | URL |
|----|-------------|----------|-----|
| `woocommerce` | COINCART.STORE | WooCommerce REST API | coincart.store |
| `shopify_komputerzz` | KOMPUTERZZ.COM | Shopify GraphQL API | komputerzz.com |
| `shopify_tiktok` | TECHSTORE TikTok Shop | Shopify GraphQL API + TikTok Shop API | (TikTok account) |
| `platform_4` | (future) | TBD | TBD |
| `platform_5` | (future) | TBD | TBD |

More channels can be added at any time. Architecture must support this without refactoring.

---

## Warehouses

| ID | Display Name | Stock Source | Can Modify Stock | Auto-Sync |
|----|-------------|-------------|-----------------|-----------|
| `ireland` | Entrepôt Irlande | Shopify TikTok Shop (auto-updated by warehouse on receipt) | ❌ No (read only) | ✅ Daily |
| `poland` | Entrepôt Pologne | API TBD (placeholder) | ❌ No (read only) | ✅ Daily (when API added) |
| `acer_store` | ACER Store | Web scraping (no native API — Claude agent or Playwright) | ✅ Yes (manual override + ordered qty) | ✅ Daily (scraping) |
| `spain` | Entrepôt Espagne (future) | TBD | ❌ TBD | TBD |

**Stock rules:**
- Ireland and Poland stocks are auto-updated by their respective systems. Syncdash reads them, does NOT write to them.
- ACER Store has no API — stock is obtained via web scraping. Syncdash may manually override ACER Store quantities and fill in "quantity ordered" and "last order date".
- Syncdash may update `quantity_ordered` and `last_order_date` for any warehouse.
- Spain warehouse (future): restricted to TikTok Shop channel only.

**Warehouse ↔ Channel relationship:**
- Warehouses and channels are independent. A warehouse can supply multiple channels.
- Ireland and Poland: can sell on any channel (WooCommerce, Komputerzz, TikTok).
- Spain (future): TikTok Shop only.
- ACER Store: physical stock source, not a sales channel.

---

## Core Features

### 1. Product Catalogue (Master View)

All ~300 products visible in a dense, filterable table. Each row shows:

| Column | Notes |
|--------|-------|
| Supplier | For now always ACER. Clickable → supplier page |
| SKU | Unique key. Clickable → product detail page |
| Name | Product title |
| Has description? | Y/N — is there a description in D1 |
| Coincart status | Published / Absent / Out of stock / Disabled |
| Coincart price | + promo price if set |
| Komputerzz status | Published / Absent / Out of stock / Disabled |
| Komputerzz price | + promo price if set |
| Tech Store status | Published / Absent / Out of stock / Disabled |
| Tech Store price | + promo price if set |
| Ireland stock | Qty from Shopify TikTok |
| Poland stock | Qty (placeholder until API integrated) |
| ACER Store stock | Qty from scraping |
| WooCommerce categories | Clickable tags |
| Shopify collections | Clickable tags |
| Localized? | FRA / ITA / POR / SPA / GER / UK / CHE / SWE / No — inferred from country_layout collection |
| Featured? | Y/N |
| Attributes | From Shopify Komputerzz metafields |
| Has 5 photos? | Y/N |

**Filters:**
- Collections (Shopify)
- Categories (WooCommerce)
- Warehouse (filter by stock presence in a warehouse)
- On promo (compare_at price is set on at least one channel)

**Search:** by SKU or product name

### 2. Product Detail Page

Single page showing all product info without scrolling. Includes:
- Master data (title, description, vendor, taxCode, weight, attributes)
- Per-platform status, price, promo price, stock
- Images (count + thumbnails)
- Collections and categories
- Localization info
- Variants (if any)
- Sync log for this SKU (last N operations)
- Action buttons: push to channel, update price, update images, toggle status, set out of stock

### 3. Sales Channels

- `/channels` — list of all channels with: name, URL, product count, last import date, API status
- `/channels/[id]` — list of products on that channel:
  - **In stock** (published + stock > 0)
  - **Disabled** (archived/inactive on that channel)
  - **Out of stock** (published + stock = 0)
  - Does NOT show products absent from the channel

### 4. Warehouses

- `/warehouses` — list of all warehouses with: name, address, last sync date, API status, total products in stock
- `/warehouses/[id]` — warehouse detail:
  - Address
  - Last API/sync update timestamp
  - Per-product: SKU (clickable), description, purchase price, qty in stock, qty ordered, last order date
  - Manual "Force sync" button

### 5. Orders (Purchase Orders to Suppliers)

- `/orders` — list of all purchase orders
- `/orders/[id]` — order detail

Per order:
| Field | Notes |
|-------|-------|
| Invoice number | Unique reference |
| Products | List with qty + unit purchase price HT |
| Date | Order date |
| Delivery warehouse | Ireland or Poland (clickable → warehouse page) |
| Paid? | Y/N |
| Sent to supplier? | Y/N |
| Supplier | Name (clickable → supplier page) |

**Order auto-reconciliation:** Syncdash compares daily stock snapshots vs expected order quantities and updates order status:
- Arrived: stock increased by ≥ ordered qty
- Partially arrived: stock increased but < ordered qty (e.g., ordered 20, received 15)

### 6. Suppliers

- `/suppliers` — list of suppliers
- `/suppliers/[id]` — supplier detail

Per supplier:
- Company name
- Contact: first name, last name
- Email
- Linked products (all products from this supplier)
- Linked orders

### 7. Daily Automation

Runs once per day automatically:
1. **Sync warehouses:** Read Ireland stock (Shopify), scrape ACER Store, Poland (when API available)
2. **Confirm on home page:** Show last sync timestamp per warehouse (success/failure)
3. **Push to channels:** Update stock levels + product status on configured channels (not TikTok — auto-updated by warehouse). Channel push rules are configurable.
4. **Reconcile orders:** Compare stock delta vs open purchase orders → auto-update order received/partially-received status
5. **Manual overrides:** Force-sync button per warehouse in the UI

### 8. Daily API Health Check

Runs once per day for every connected API:
- Simple read + write test on each platform/connector
- Reports: functional ✅ / KO ❌ per connection
- Measures total test duration in minutes
- Results shown on the home page dashboard

### 9. Agent-Accessible REST API

All functions exposed as authenticated REST endpoints. Callable by:
- The web UI (via TanStack Query)
- External AI agents (Claude) via Bearer token
- External applications

---

## UI Design Principles

- **Minimalist but information-dense:** Show maximum relevant data with minimum visual noise
- **Clickable cross-references everywhere:**
  - SKUs → `/products/[sku]`
  - Sales channels → `/channels/[id]`
  - Warehouses → `/warehouses/[id]`
  - Suppliers → `/suppliers/[id]`
  - Order numbers → `/orders/[id]`
- **Desktop-first:** Not mobile-optimized (internal tool)
- **No scrolling on product detail:** All info visible on one screen

---

## Page Map

```
/                           → Dashboard (stats, API health, daily sync status, recent logs)
/products                   → Product table (filters + search)
/products/new               → Create product
/products/[sku]             → Product detail (all info, no scroll)
/products/[sku]/edit        → Edit product

/channels                   → Sales channels list
/channels/[id]              → Channel product list (in stock / disabled / out of stock)

/warehouses                 → Warehouses list
/warehouses/[id]            → Warehouse detail (stock, orders, force sync)

/orders                     → Purchase orders list
/orders/[id]                → Order detail
/orders/new                 → Create order

/suppliers                  → Suppliers list
/suppliers/[id]             → Supplier detail

/analyze                    → Inconsistency report (cross-platform diffs)
/mappings                   → Shopify collection ↔ WooCommerce category mapping
/validate                   → WooCommerce readiness check
/sync                       → Bulk push actions
/sync/logs                  → Full sync/operation log
/tiktok                     → TikTok selection management (30-40 products)
/settings                   → API keys, env config
/settings/import            → Import from platforms
```

---

## Out of Scope (v1)

- Multi-user management / roles (single operator, Cloudflare Access handles auth)
- Billing / subscriptions
- AI-generated content (all operations are deterministic)
- Spain warehouse (architecture planned, not implemented)
- Platform 4 and 5 connectors (architecture planned, stubs only)
- Poland stock API (placeholder until system is defined)
- TikTok Shop API direct integration (stock auto-updated via Shopify)

---

## Constraints

| Constraint | Detail |
|------------|--------|
| D1 SQLite | No complex joins at scale — sufficient for ~300 products |
| Shopify rate limit | 2 req/s — respected inside connectors |
| WooCommerce rate limit | Max 100 products/page, paginated |
| ACER Store | No native API — requires web scraping (Playwright or Claude agent) |
| Poland stock | API TBD — placeholder tables and stubs only |
| Cloudflare Workers | No long-running processes — daily sync via Cloudflare Cron Triggers |

---

## Open Questions

- ACER Store scraping: Playwright on Cloudflare Worker vs dedicated scraping service vs Claude agent?
- Poland stock system: which platform / API when integrated?
- Featured product definition: Shopify metafield, tag, or manual flag in D1?
- Spain warehouse channel restriction: hardcoded or configurable per warehouse?
