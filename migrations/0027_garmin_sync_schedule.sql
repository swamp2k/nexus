ALTER TABLE user_settings
ADD COLUMN garmin_sync_enabled INTEGER NOT NULL DEFAULT 1
CHECK (garmin_sync_enabled IN (0, 1));

ALTER TABLE user_settings
ADD COLUMN garmin_sync_hours TEXT NOT NULL DEFAULT '[9,12,18,22]';
