PRAGMA foreign_keys = ON;

CREATE TABLE user_home_layout (
  user_id TEXT PRIMARY KEY,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
