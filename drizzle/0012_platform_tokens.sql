-- Migration 12: platform_tokens — stores Shopify OAuth access tokens refreshed via UI
CREATE TABLE IF NOT EXISTS platform_tokens (
  platform     TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
