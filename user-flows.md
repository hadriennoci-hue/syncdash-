# User Flows

> Key workflows for the human operator and the AI agent

---

## 1. Initial Setup (One-Time)

1. Cloudflare Access configured — no credentials in the app.
2. Open Settings, enter API keys for all 3 platforms and warehouse connectors.
3. Go to Settings > Import, run the Komputerzz import first.
   - D1 gets populated: all ~300 products, variants, images, metafields, collections.
4. Run import for WooCommerce and TikTok Shopify to load comparison data.
5. Go to /mappings — manually map each Shopify collection to a WooCommerce category (one-time).
6. Add suppliers (Settings > Suppliers) — at minimum: ACER.
7. Dashboard now shows catalogue state, API health, and sync status.

---

## 2. Daily Operator Flow

1. Visit `/` (Dashboard):
   - Check API health status (all connections functional?)
   - Check daily sync confirmation (warehouses synced? channels pushed?)
   - Review recent sync logs
2. If any API is KO → go to Settings to review credentials.
3. Go to `/products` — filter by inconsistencies or use search.
4. Click a product (SKU) to open `/products/[sku]` — see full diff.
5. Apply fixes: push to channel, update price, copy images, toggle status.

---

## 3. Viewing a Sales Channel

1. Go to `/channels` — see list of all channels with product counts and API status.
2. Click a channel name → `/channels/[id]`
3. Three tabs: **In stock** / **Disabled** / **Out of stock**
   - Does NOT show products absent from the channel
4. Click any SKU → `/products/[sku]`

---

## 4. Viewing Warehouse Stock

1. Go to `/warehouses` — see Ireland, Poland (TBD), ACER Store with last sync timestamp.
2. Click a warehouse → `/warehouses/[id]`
3. See: address, last sync date, per-product table (SKU, description, qty, qty ordered, last order date, purchase price)
4. Click SKU → `/products/[sku]`
5. Click "Force Sync" to trigger an immediate stock update for this warehouse.

---

## 5. Manually Overriding ACER Store Stock

1. Go to `/warehouses/acer_store`
2. Find the product row
3. Click the edit icon (pencil) on the quantity field
4. Update: quantity, quantity_ordered, last_order_date, purchase_price
5. Save → calls `PATCH /api/warehouses/acer_store/stock`
6. Changes logged in sync_log (triggered_by: 'human')

> Ireland and Poland rows are read-only — no edit icon shown.

---

## 6. Creating a Purchase Order

1. Go to `/orders/new`
2. Select supplier (e.g. ACER), delivery warehouse (Ireland or Poland), order date
3. Add products: SKU search, quantity, unit purchase price HT
4. Mark as "sent to supplier" if already sent
5. Save → creates order + order_items + updates warehouse_stock.quantity_ordered
6. Order appears in `/orders` list

---

## 7. Order Reconciliation (Automated)

Daily cron runs:
1. For each open order (arrival_status = 'pending'):
2. Compare current warehouse stock vs stock at order creation
3. If stock increased ≥ ordered qty → mark **arrived**, update quantity_received
4. If stock increased but < ordered qty → mark **partial**, record quantity_received
5. Dashboard shows reconciliation summary in daily sync confirmation

Manual override: go to `/orders/[id]` and manually update `quantity_received` per line.

---

## 8. Creating a New Product

1. Go to `/products/new`
2. Enter: SKU, title, description (English), vendor, product type, supplier
3. Add variants (if any) with their own SKU, price, stock
4. Set prices per platform
5. Assign Shopify collections (required for WooCommerce push)
6. Upload images (drag-drop or URL)
7. Select target platforms → click Create
8. UI shows `SyncResult` per platform, logged as `triggered_by: 'human'`

---

## 9. Updating Product Images

From `/products/[sku]`:

**A — Upload new images:** files or URLs → select platforms → Replace or Add → calls `setProductImages()` or `addProductImages()`

**B — Copy from another platform:** e.g. copy from Shopify Komp to WooCommerce → Replace or Add → calls `copyImagesBetweenPlatforms()`

Result shown per platform + logged to sync_log.

---

## 10. Bulk Push

1. Go to `/sync`
2. Select products via checkboxes or filters
3. Choose action: toggle status / push title+description / push prices / replace images
4. Select target platforms
5. Confirm → operations run sequentially with rate limiting
6. Progress shown, final report with success/error counts
7. All entries logged in sync_log

---

## 11. TikTok Catalogue Management

1. Go to `/tiktok`
2. Left panel: current 30-40 TikTok products
3. Right panel: all products not in TikTok selection
4. Add: click "Add to TikTok" → creates on `shopify_tiktok`
5. Remove: click "Remove" → archives on `shopify_tiktok`

---

## 12. API Health Check Flow

**Automated (daily cron):**
1. Each connector runs `healthCheck()` (read + reversible write)
2. Results recorded in `api_health_log` with latency and status
3. Total duration measured in seconds
4. Results shown on `/` (home page)

**Manual:**
1. Go to `/` — click "Run health check now"
2. Calls `POST /api/health`
3. Page refreshes with new results

---

## 13. AI Agent Session Flow

**Step 1 — Import:**
Agent calls `POST /api/import/shopify_komputerzz`, then `/woocommerce`, then `/shopify_tiktok`.

**Step 2 — Sync warehouses:**
Agent calls `POST /api/warehouses/ireland/sync` to get current stock snapshot.

**Step 3 — Analyse:**
Agent calls `GET /api/analyze` → receives `InconsistencyReport[]`.

**Step 4 — Report to human:**
Agent: "47 inconsistencies found: 23 products missing images on WooCommerce, 14 different descriptions, 10 missing categories. Start with images?"

**Step 5 — Human confirms, agent applies fixes:**
Agent: "SKU-001: WooCommerce has 0 images, Shopify Komp has 5. Copy in replace mode?"
Human: "Yes"
Agent calls `POST /api/products/SKU-001/images/copy` (source: shopify_komputerzz, targets: woocommerce, mode: replace, triggeredBy: agent)

**Step 6:** Loop until all inconsistencies resolved. All operations logged with `triggered_by: 'agent'`.

---

## 14. Error States

| Error | Handling |
|-------|----------|
| 401 Unauthorized | Invalid Bearer token — check AGENT_BEARER_TOKEN env var |
| 403 Forbidden | Attempted write on read-only warehouse (Ireland, Poland) |
| 404 Product not found | SKU not in D1 — run import first |
| Platform mapping missing | Product in D1 but not on target platform — run createProduct() first |
| Platform API error | Operation logged as error, other platforms in batch still attempted |
| Rate limit | Handled automatically inside connectors (Shopify: 2 req/s) |
| Warehouse sync failure | Logged in daily_sync_log with status 'partial' or 'error' |
| Scraping failure (ACER Store) | Logged, last known values retained, operator alerted on dashboard |
