CREATE TABLE garmin_credentials (
  user_id TEXT PRIMARY KEY,
  username_ciphertext TEXT NOT NULL,
  username_iv TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_garmin_credentials_updated ON garmin_credentials(updated_at DESC);
