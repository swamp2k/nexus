-- Privateering ingest tokens, managed from the Nexus web UI instead of a
-- Cloudflare secret. Only the SHA-256 hash of the token is stored; the
-- plaintext is shown once at generation time and never persisted.
CREATE TABLE privateering_ingest_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
