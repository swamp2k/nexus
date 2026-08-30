CREATE TABLE garmin_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_garmin_agents_user ON garmin_agents(user_id, revoked_at);

CREATE TABLE garmin_sync_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  import_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'processing', 'complete', 'failed')),
  message TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES garmin_agents(id) ON DELETE SET NULL,
  FOREIGN KEY (import_id) REFERENCES garmin_imports(id) ON DELETE SET NULL
);

CREATE INDEX idx_garmin_sync_jobs_user ON garmin_sync_jobs(user_id, requested_at DESC);
CREATE INDEX idx_garmin_sync_jobs_queue ON garmin_sync_jobs(status, requested_at);
