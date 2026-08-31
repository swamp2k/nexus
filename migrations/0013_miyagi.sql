CREATE TABLE IF NOT EXISTS miyagi_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_days INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  model TEXT NOT NULL,
  context_json TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_miyagi_analyses_user_created
  ON miyagi_analyses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS miyagi_messages (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES miyagi_analyses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_miyagi_messages_analysis_created
  ON miyagi_messages(analysis_id, created_at);
