CREATE TABLE electricity_usage_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metering_point TEXT NOT NULL,
  date TEXT NOT NULL,
  kwh REAL NOT NULL CHECK(kwh >= 0),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, metering_point, date)
);
