ALTER TABLE miyagi_analyses ADD COLUMN focus TEXT;
ALTER TABLE miyagi_analyses ADD COLUMN response_length TEXT NOT NULL DEFAULT 'short';
ALTER TABLE miyagi_analyses ADD COLUMN tone TEXT NOT NULL DEFAULT 'empathetic';

CREATE TABLE IF NOT EXISTS journal_ai_state (
  user_id TEXT PRIMARY KEY,
  context_summary TEXT,
  summary_covers_until TEXT,
  summary_updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
