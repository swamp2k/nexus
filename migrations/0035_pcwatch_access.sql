-- PC Watch is one shared data set. Access is granted per Nexus user.
CREATE TABLE pcwatch_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL
);
