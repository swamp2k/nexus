CREATE TABLE IF NOT EXISTS garmin_daily (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  import_id TEXT,
  steps INTEGER,
  step_goal INTEGER,
  distance_m REAL,
  total_calories REAL,
  active_calories REAL,
  resting_hr REAL,
  min_hr REAL,
  max_hr REAL,
  avg_stress REAL,
  max_stress REAL,
  body_battery_high REAL,
  body_battery_low REAL,
  body_battery_charged REAL,
  body_battery_drained REAL,
  body_battery_latest REAL,
  waking_respiration REAL,
  sleeping_seconds INTEGER,
  active_seconds INTEGER,
  sedentary_seconds INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS garmin_sleep (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  import_id TEXT,
  sleep_start_ms INTEGER,
  sleep_end_ms INTEGER,
  sleep_seconds INTEGER,
  nap_seconds INTEGER,
  deep_seconds INTEGER,
  light_seconds INTEGER,
  rem_seconds INTEGER,
  awake_seconds INTEGER,
  avg_respiration REAL,
  low_respiration REAL,
  high_respiration REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS garmin_rhr (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  import_id TEXT,
  resting_hr REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS garmin_weight (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  import_id TEXT,
  weight_kg REAL,
  bmi REAL,
  body_fat_pct REAL,
  body_water_pct REAL,
  bone_mass_kg REAL,
  muscle_mass_kg REAL,
  visceral_fat REAL,
  metabolic_age REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS garmin_activities (
  user_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  import_id TEXT,
  activity_uuid TEXT,
  name TEXT,
  type TEXT,
  start_time_local TEXT,
  start_time_gmt TEXT,
  duration_seconds REAL,
  moving_seconds REAL,
  distance_m REAL,
  calories REAL,
  avg_hr REAL,
  max_hr REAL,
  steps INTEGER,
  elevation_gain_m REAL,
  elevation_loss_m REAL,
  vo2max REAL,
  location_name TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_garmin_daily_user_date ON garmin_daily(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_garmin_sleep_user_date ON garmin_sleep(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_garmin_activities_user_start ON garmin_activities(user_id, start_time_gmt DESC);
