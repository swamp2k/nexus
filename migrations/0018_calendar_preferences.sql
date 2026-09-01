CREATE TABLE IF NOT EXISTS calendar_preferences (
  user_id TEXT PRIMARY KEY,
  waste_warning_days INTEGER NOT NULL DEFAULT 1 CHECK (waste_warning_days BETWEEN 0 AND 7),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
