CREATE TABLE IF NOT EXISTS eloverblik_credentials (
  user_id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  metering_point TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
