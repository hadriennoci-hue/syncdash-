-- Migration 19: sales analytics ingestion + normalized sales model
-- Platform-agnostic raw ingestion tables (Shopify, WooCommerce, etc.)

CREATE TABLE IF NOT EXISTS raw_channel_orders (
  raw_pk              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id          TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  external_order_id   TEXT NOT NULL,
  external_order_name TEXT,
  source_created_at   TEXT,
  source_updated_at   TEXT,
  payload_json        TEXT NOT NULL,
  payload_checksum    TEXT,
  synced_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_channel_orders_snapshot
  ON raw_channel_orders(channel_id, external_order_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_raw_channel_orders_channel
  ON raw_channel_orders(channel_id);
CREATE INDEX IF NOT EXISTS idx_raw_channel_orders_updated
  ON raw_channel_orders(source_updated_at);

CREATE TABLE IF NOT EXISTS raw_channel_refunds (
  raw_pk               INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id           TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  platform             TEXT NOT NULL,
  external_refund_id   TEXT NOT NULL,
  external_order_id    TEXT NOT NULL,
  source_created_at    TEXT,
  source_updated_at    TEXT,
  payload_json         TEXT NOT NULL,
  payload_checksum     TEXT,
  synced_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_channel_refunds_snapshot
  ON raw_channel_refunds(channel_id, external_refund_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_raw_channel_refunds_channel
  ON raw_channel_refunds(channel_id);
CREATE INDEX IF NOT EXISTS idx_raw_channel_refunds_order
  ON raw_channel_refunds(channel_id, external_order_id);

CREATE TABLE IF NOT EXISTS raw_channel_transactions (
  raw_pk                    INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id                TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  platform                  TEXT NOT NULL,
  external_transaction_id   TEXT NOT NULL,
  external_order_id         TEXT,
  external_refund_id        TEXT,
  source_created_at         TEXT,
  source_updated_at         TEXT,
  payload_json              TEXT NOT NULL,
  payload_checksum          TEXT,
  synced_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_channel_transactions_snapshot
  ON raw_channel_transactions(channel_id, external_transaction_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_raw_channel_transactions_channel
  ON raw_channel_transactions(channel_id);
CREATE INDEX IF NOT EXISTS idx_raw_channel_transactions_order
  ON raw_channel_transactions(channel_id, external_order_id);

CREATE TABLE IF NOT EXISTS raw_channel_fulfillments (
  raw_pk                    INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id                TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  platform                  TEXT NOT NULL,
  external_fulfillment_id   TEXT NOT NULL,
  external_order_id         TEXT NOT NULL,
  source_created_at         TEXT,
  source_updated_at         TEXT,
  payload_json              TEXT NOT NULL,
  payload_checksum          TEXT,
  synced_at                 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_channel_fulfillments_snapshot
  ON raw_channel_fulfillments(channel_id, external_fulfillment_id, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_raw_channel_fulfillments_channel
  ON raw_channel_fulfillments(channel_id);
CREATE INDEX IF NOT EXISTS idx_raw_channel_fulfillments_order
  ON raw_channel_fulfillments(channel_id, external_order_id);

-- Normalized sales model
-- Amount fields use minor units (cents) + currency_code for accuracy.

CREATE TABLE IF NOT EXISTS sales_orders (
  order_pk                 INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id               TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  external_order_id        TEXT NOT NULL,
  external_order_name      TEXT,
  platform                 TEXT NOT NULL,
  external_checkout_id     TEXT,
  customer_external_id     TEXT,
  customer_email           TEXT,
  customer_name            TEXT,
  customer_phone           TEXT,
  currency_code            TEXT,
  financial_status         TEXT,
  fulfillment_status       TEXT,
  order_status             TEXT,
  source_name              TEXT,
  cancel_reason            TEXT,
  is_test_order            INTEGER NOT NULL DEFAULT 0,
  order_created_at         TEXT NOT NULL,
  order_processed_at       TEXT,
  order_updated_at         TEXT,
  order_cancelled_at       TEXT,
  order_closed_at          TEXT,
  subtotal_amount_cents    INTEGER,
  discount_amount_cents    INTEGER,
  shipping_amount_cents    INTEGER,
  tax_amount_cents         INTEGER,
  total_amount_cents       INTEGER,
  refunded_amount_cents    INTEGER NOT NULL DEFAULT 0,
  net_amount_cents         INTEGER,
  shipping_name            TEXT,
  shipping_city            TEXT,
  shipping_region          TEXT,
  shipping_country         TEXT,
  shipping_postal_code     TEXT,
  billing_name             TEXT,
  billing_city             TEXT,
  billing_region           TEXT,
  billing_country          TEXT,
  billing_postal_code      TEXT,
  tags                     TEXT,
  note                     TEXT,
  raw_source_table         TEXT NOT NULL,
  raw_source_id            TEXT NOT NULL,
  inserted_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_channel_created
  ON sales_orders(channel_id, order_created_at);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_email
  ON sales_orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status
  ON sales_orders(order_status, financial_status, fulfillment_status);

CREATE TABLE IF NOT EXISTS sales_order_items (
  order_item_pk                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_pk                      INTEGER NOT NULL REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  external_line_item_id         TEXT,
  external_product_id           TEXT,
  external_variant_id           TEXT,
  sku                           TEXT,
  product_key                   TEXT,
  product_title                 TEXT,
  variant_title                 TEXT,
  vendor                        TEXT,
  quantity                      INTEGER NOT NULL,
  current_quantity              INTEGER,
  refundable_quantity           INTEGER,
  unit_price_amount_cents       INTEGER,
  line_subtotal_amount_cents    INTEGER,
  line_discount_amount_cents    INTEGER,
  line_total_amount_cents       INTEGER,
  requires_shipping             INTEGER,
  taxable                       INTEGER,
  fulfillment_status            TEXT,
  inserted_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_order_items_order
  ON sales_order_items(order_pk);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_sku
  ON sales_order_items(sku);

CREATE TABLE IF NOT EXISTS sales_refunds (
  refund_pk                     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_pk                      INTEGER NOT NULL REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  channel_id                    TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  external_refund_id            TEXT NOT NULL,
  external_order_id             TEXT NOT NULL,
  currency_code                 TEXT,
  refund_created_at             TEXT,
  refund_processed_at           TEXT,
  refund_total_amount_cents     INTEGER,
  refund_notes                  TEXT,
  raw_source_table              TEXT NOT NULL,
  raw_source_id                 TEXT NOT NULL,
  inserted_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_refund_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_refunds_order
  ON sales_refunds(order_pk);
CREATE INDEX IF NOT EXISTS idx_sales_refunds_channel_created
  ON sales_refunds(channel_id, refund_created_at);

CREATE TABLE IF NOT EXISTS sales_refund_items (
  refund_item_pk                    INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_pk                         INTEGER NOT NULL REFERENCES sales_refunds(refund_pk) ON DELETE CASCADE,
  order_item_pk                     INTEGER REFERENCES sales_order_items(order_item_pk) ON DELETE SET NULL,
  external_refund_line_item_id      TEXT,
  external_line_item_id             TEXT,
  sku                               TEXT,
  quantity                          INTEGER,
  subtotal_amount_cents             INTEGER,
  tax_amount_cents                  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sales_refund_items_refund
  ON sales_refund_items(refund_pk);

CREATE TABLE IF NOT EXISTS sales_transactions (
  transaction_pk                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_pk                          INTEGER REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  refund_pk                         INTEGER REFERENCES sales_refunds(refund_pk) ON DELETE SET NULL,
  channel_id                        TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  external_transaction_id           TEXT NOT NULL,
  external_order_id                 TEXT,
  kind                              TEXT,
  status                            TEXT,
  gateway                           TEXT,
  amount_cents                      INTEGER,
  currency_code                     TEXT,
  transaction_created_at            TEXT,
  raw_source_table                  TEXT NOT NULL,
  raw_source_id                     TEXT NOT NULL,
  inserted_at                       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_transactions_order
  ON sales_transactions(order_pk);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_refund
  ON sales_transactions(refund_pk);

CREATE TABLE IF NOT EXISTS sales_fulfillments (
  fulfillment_pk                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_pk                          INTEGER NOT NULL REFERENCES sales_orders(order_pk) ON DELETE CASCADE,
  channel_id                        TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  external_fulfillment_id           TEXT NOT NULL,
  external_order_id                 TEXT,
  status                            TEXT,
  tracking_company                  TEXT,
  tracking_number                   TEXT,
  tracking_url                      TEXT,
  fulfillment_created_at            TEXT,
  fulfillment_updated_at            TEXT,
  raw_source_table                  TEXT NOT NULL,
  raw_source_id                     TEXT NOT NULL,
  inserted_at                       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, external_fulfillment_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_fulfillments_order
  ON sales_fulfillments(order_pk);

CREATE TABLE IF NOT EXISTS sales_fulfillment_items (
  fulfillment_item_pk               INTEGER PRIMARY KEY AUTOINCREMENT,
  fulfillment_pk                    INTEGER NOT NULL REFERENCES sales_fulfillments(fulfillment_pk) ON DELETE CASCADE,
  order_item_pk                     INTEGER REFERENCES sales_order_items(order_item_pk) ON DELETE SET NULL,
  external_line_item_id             TEXT,
  sku                               TEXT,
  quantity                          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sales_fulfillment_items_fulfillment
  ON sales_fulfillment_items(fulfillment_pk);

CREATE TABLE IF NOT EXISTS sales_sync_cursors (
  channel_id                        TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  resource_type                     TEXT NOT NULL, -- orders|refunds|transactions|fulfillments
  last_source_updated_at            TEXT,
  last_external_id                  TEXT,
  last_sync_at                      TEXT,
  last_status                       TEXT,
  last_error                        TEXT,
  updated_at                        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(channel_id, resource_type)
);

