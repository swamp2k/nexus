PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS journal_legacy_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_tracker_id TEXT,
  source_message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, source, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_journal_legacy_messages_user_created
  ON journal_legacy_messages(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_journal_legacy_messages_tracker_created
  ON journal_legacy_messages(user_id, source, source_tracker_id, created_at);
