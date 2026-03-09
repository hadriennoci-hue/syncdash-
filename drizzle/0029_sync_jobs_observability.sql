ALTER TABLE platform_mappings ADD COLUMN last_seen_in_feed_at TEXT;

CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  platform TEXT,
  batch_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  touched INTEGER NOT NULL DEFAULT 0,
  zeroed INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  triggered_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
