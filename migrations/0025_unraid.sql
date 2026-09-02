CREATE TABLE IF NOT EXISTS unraid_servers (
  user_id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'Tower',
  url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
