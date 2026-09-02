CREATE TABLE IF NOT EXISTS user_navigation (
  user_id TEXT PRIMARY KEY,
  order_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
