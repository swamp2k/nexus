PRAGMA foreign_keys = ON;

CREATE TABLE garmin_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_size_bytes INTEGER,
  source_content_type TEXT,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'inventorying', 'ready', 'processing', 'complete', 'failed')),
  file_count INTEGER,
  detected_from TEXT,
  detected_to TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_garmin_imports_user_created
  ON garmin_imports(user_id, created_at DESC);

CREATE TABLE garmin_import_files (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER,
  file_type TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'supported', 'ignored', 'processed', 'failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES garmin_imports(id) ON DELETE CASCADE,
  UNIQUE(import_id, path)
);

CREATE INDEX idx_garmin_import_files_import
  ON garmin_import_files(import_id);
