CREATE TABLE IF NOT EXISTS project_map_registry (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  repos_json TEXT NOT NULL DEFAULT '[]',
  workers_json TEXT NOT NULL DEFAULT '[]',
  pages_json TEXT NOT NULL DEFAULT '[]',
  domains_json TEXT NOT NULL DEFAULT '[]',
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);