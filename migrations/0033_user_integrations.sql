PRAGMA foreign_keys = ON;

CREATE TABLE user_integrations (
  user_id TEXT NOT NULL,
  integration_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, integration_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_integrations_user
  ON user_integrations(user_id);
