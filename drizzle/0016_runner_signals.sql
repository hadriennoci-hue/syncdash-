CREATE TABLE IF NOT EXISTS runner_signals (
  runner TEXT PRIMARY KEY NOT NULL,
  wake_nonce INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO runner_signals (runner, wake_nonce, reason, requested_at, updated_at)
VALUES ('browser', 0, 'bootstrap', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
