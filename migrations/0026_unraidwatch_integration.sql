-- Nexus reads Unraid data through UnraidWatch's integration contract.
--
-- Nexus stores only a revocable UnraidWatch integration token, encrypted at
-- rest. It no longer stores an Unraid API key or an Unraid server URL.

CREATE TABLE IF NOT EXISTS unraidwatch_integrations (
  user_id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'UnraidWatch',
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 0025 stored the Unraid API key directly in Nexus. That responsibility now
-- belongs entirely to UnraidWatch, so the table and any encrypted keys still in
-- it are removed. Safe whether or not 0025 was ever applied: nothing references
-- unraid_servers.
DROP TABLE IF EXISTS unraid_servers;
