PRAGMA foreign_keys = OFF;

ALTER TABLE wellbeing_metrics
  ADD COLUMN value_type TEXT NOT NULL DEFAULT 'scale'
  CHECK (value_type IN ('scale', 'boolean'));

CREATE TABLE wellbeing_entries_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (metric_id) REFERENCES wellbeing_metrics(id) ON DELETE CASCADE,
  UNIQUE (user_id, metric_id, entry_date)
);

INSERT INTO wellbeing_entries_new
  (id, user_id, metric_id, entry_date, value, created_at, updated_at)
SELECT id, user_id, metric_id, entry_date, value, created_at, updated_at
FROM wellbeing_entries;

DROP TABLE wellbeing_entries;
ALTER TABLE wellbeing_entries_new RENAME TO wellbeing_entries;

CREATE INDEX idx_wellbeing_entries_user_date
  ON wellbeing_entries(user_id, entry_date DESC);

PRAGMA foreign_keys = ON;
