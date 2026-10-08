-- Admin-managed credentials for the Nexus Project Map.
-- Tokens are encrypted before storage and are never returned by the API.
CREATE TABLE IF NOT EXISTS project_map_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  github_token_ciphertext TEXT NOT NULL,
  github_token_iv TEXT NOT NULL,
  cloudflare_token_ciphertext TEXT NOT NULL,
  cloudflare_token_iv TEXT NOT NULL,
  cloudflare_account_id TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
