CREATE TABLE IF NOT EXISTS display_pairing_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_display_pairing_codes_expiry
  ON display_pairing_codes(expires_at, used_at);

CREATE TABLE IF NOT EXISTS display_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pairing_code_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_code_id) REFERENCES display_pairing_codes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_display_devices_user
  ON display_devices(user_id, revoked_at, created_at);
