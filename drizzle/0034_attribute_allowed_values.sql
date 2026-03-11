CREATE TABLE IF NOT EXISTS attribute_allowed_values (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attribute_allowed_values_ckv
ON attribute_allowed_values (collection, key, value_normalized);
