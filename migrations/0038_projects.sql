-- Projects: a hand-curated registry of Martin's apps/sites plus a daily
-- snapshot of what actually exists on GitHub and Cloudflare. Shared admin
-- data (describes infrastructure, not a user's personal data).
-- Drift is computed on read by comparing the two tables.
-- Seed rows live in tools/projects-seed.sql, not here.
CREATE TABLE project_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'retired')),
  repos_json TEXT NOT NULL DEFAULT '[]',
  workers_json TEXT NOT NULL DEFAULT '[]',
  pages_json TEXT NOT NULL DEFAULT '[]',
  d1_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  updated_at TEXT NOT NULL
);

-- Replaced per kind on each successful scan; a failed source keeps its old rows.
CREATE TABLE project_discovery (
  kind TEXT NOT NULL CHECK (kind IN ('repo', 'worker', 'pages', 'd1')),
  name TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  seen_at TEXT NOT NULL,
  PRIMARY KEY (kind, name)
);
