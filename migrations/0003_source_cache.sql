CREATE TABLE source_cache (
  source_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_error_at TEXT,
  last_error_message TEXT
);

CREATE INDEX idx_source_cache_expires
  ON source_cache(expires_at);
