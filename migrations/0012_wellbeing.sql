PRAGMA foreign_keys = ON;

CREATE TABLE wellbeing_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🙂',
  direction TEXT NOT NULL DEFAULT 'high_good' CHECK (direction IN ('high_good', 'high_bad')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_wellbeing_metrics_user
  ON wellbeing_metrics(user_id, active, sort_order, created_at);

CREATE TABLE wellbeing_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (metric_id) REFERENCES wellbeing_metrics(id) ON DELETE CASCADE,
  UNIQUE (user_id, metric_id, entry_date)
);

CREATE INDEX idx_wellbeing_entries_user_date
  ON wellbeing_entries(user_id, entry_date DESC);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_journal_entries_user_date
  ON journal_entries(user_id, entry_date DESC, created_at DESC);

CREATE TABLE journal_followups (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_journal_followups_entry
  ON journal_followups(journal_entry_id, created_at);
