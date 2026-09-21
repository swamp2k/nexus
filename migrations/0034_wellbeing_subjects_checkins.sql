PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wellbeing_subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'self' CHECK (kind IN ('self', 'person')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  allow_multiple_checkins INTEGER NOT NULL DEFAULT 0 CHECK (allow_multiple_checkins IN (0, 1)),
  garmin_enabled INTEGER NOT NULL DEFAULT 0 CHECK (garmin_enabled IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wellbeing_subjects_default
  ON wellbeing_subjects(user_id)
  WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_wellbeing_subjects_user
  ON wellbeing_subjects(user_id, active, created_at);

INSERT OR IGNORE INTO wellbeing_subjects
  (id, user_id, name, kind, is_default, allow_multiple_checkins, garmin_enabled, active, created_at, updated_at)
SELECT
  'self:' || id, id, 'Mig', 'self', 1, 0, 1, 1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users;

ALTER TABLE wellbeing_metrics ADD COLUMN subject_id TEXT;
UPDATE wellbeing_metrics SET subject_id = 'self:' || user_id WHERE subject_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_wellbeing_metrics_subject
  ON wellbeing_metrics(user_id, subject_id, active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS wellbeing_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES wellbeing_subjects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_checkins_subject_date
  ON wellbeing_checkins(user_id, subject_id, entry_date DESC, occurred_at DESC);

INSERT OR IGNORE INTO wellbeing_checkins
  (id, user_id, subject_id, entry_date, occurred_at, created_at, updated_at)
SELECT
  'legacy:' || user_id || ':' || entry_date,
  user_id,
  'self:' || user_id,
  entry_date,
  COALESCE(MIN(created_at), entry_date || 'T12:00:00.000Z'),
  COALESCE(MIN(created_at), entry_date || 'T12:00:00.000Z'),
  COALESCE(MAX(updated_at), MIN(created_at), entry_date || 'T12:00:00.000Z')
FROM wellbeing_entries
GROUP BY user_id, entry_date;

INSERT OR IGNORE INTO wellbeing_checkins
  (id, user_id, subject_id, entry_date, occurred_at, created_at, updated_at)
SELECT
  'legacy:' || user_id || ':' || entry_date,
  user_id,
  'self:' || user_id,
  entry_date,
  COALESCE(MIN(created_at), entry_date || 'T12:00:00.000Z'),
  COALESCE(MIN(created_at), entry_date || 'T12:00:00.000Z'),
  COALESCE(MAX(updated_at), MIN(created_at), entry_date || 'T12:00:00.000Z')
FROM journal_entries
GROUP BY user_id, entry_date;

PRAGMA foreign_keys = OFF;

CREATE TABLE wellbeing_entries_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  checkin_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES wellbeing_subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (checkin_id) REFERENCES wellbeing_checkins(id) ON DELETE CASCADE,
  FOREIGN KEY (metric_id) REFERENCES wellbeing_metrics(id) ON DELETE CASCADE,
  UNIQUE (checkin_id, metric_id)
);

INSERT INTO wellbeing_entries_v2
  (id, user_id, subject_id, checkin_id, metric_id, entry_date, value, created_at, updated_at)
SELECT
  id, user_id, 'self:' || user_id, 'legacy:' || user_id || ':' || entry_date,
  metric_id, entry_date, value, created_at, updated_at
FROM wellbeing_entries;

DROP TABLE wellbeing_entries;
ALTER TABLE wellbeing_entries_v2 RENAME TO wellbeing_entries;

CREATE INDEX idx_wellbeing_entries_user_date
  ON wellbeing_entries(user_id, entry_date DESC);
CREATE INDEX idx_wellbeing_entries_subject_checkin
  ON wellbeing_entries(user_id, subject_id, checkin_id);

ALTER TABLE journal_entries ADD COLUMN subject_id TEXT;
ALTER TABLE journal_entries ADD COLUMN checkin_id TEXT;
UPDATE journal_entries
SET subject_id = 'self:' || user_id,
    checkin_id = 'legacy:' || user_id || ':' || entry_date
WHERE subject_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_subject_date
  ON journal_entries(user_id, subject_id, entry_date DESC, created_at DESC);

ALTER TABLE miyagi_conversation_messages ADD COLUMN subject_id TEXT;
ALTER TABLE miyagi_conversation_messages ADD COLUMN checkin_id TEXT;
UPDATE miyagi_conversation_messages
SET subject_id = (
      SELECT j.subject_id FROM journal_entries j
      WHERE j.id = miyagi_conversation_messages.journal_entry_id
    ),
    checkin_id = (
      SELECT j.checkin_id FROM journal_entries j
      WHERE j.id = miyagi_conversation_messages.journal_entry_id
    )
WHERE journal_entry_id IS NOT NULL;

ALTER TABLE miyagi_analyses ADD COLUMN subject_id TEXT;
UPDATE miyagi_analyses SET subject_id = 'self:' || user_id WHERE subject_id IS NULL;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wellbeing_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  hour_local INTEGER NOT NULL DEFAULT 20 CHECK (hour_local BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  channel TEXT NOT NULL DEFAULT 'discord' CHECK (channel IN ('discord')),
  last_sent_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES wellbeing_subjects(id) ON DELETE CASCADE,
  UNIQUE (user_id, subject_id, channel)
);
