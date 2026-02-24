-- Migration 10: sales_channels table
-- Stores all sale channel metadata (API and browser-automated)
-- Credentials (API keys, passwords) are NEVER stored here — they live in env vars / Cloudflare secrets

CREATE TABLE IF NOT EXISTS sales_channels (
  id             TEXT PRIMARY KEY,                     -- matches Platform type: 'woocommerce', 'libre_market', etc.
  name           TEXT NOT NULL,                        -- display name
  url            TEXT NOT NULL,                        -- storefront URL
  connector_type TEXT NOT NULL,                        -- 'woocommerce_api' | 'shopify_api' | 'browser'
  enabled        INTEGER NOT NULL DEFAULT 1,
  config         TEXT,                                 -- JSON: non-sensitive platform-specific config
  last_push      TEXT,                                 -- ISO timestamp of last successful push
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
