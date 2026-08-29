PRAGMA foreign_keys = ON;

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  weather_label TEXT,
  weather_lat REAL,
  weather_lon REAL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (weather_lat IS NULL OR (weather_lat >= -90 AND weather_lat <= 90)),
  CHECK (weather_lon IS NULL OR (weather_lon >= -180 AND weather_lon <= 180))
);
