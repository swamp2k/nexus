PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS miyagi_conversation_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'checkin', 'legacy')),
  analysis_id TEXT,
  journal_entry_id TEXT,
  source_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_id) REFERENCES miyagi_analyses(id) ON DELETE SET NULL,
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_miyagi_conversation_user_created
  ON miyagi_conversation_messages(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_miyagi_conversation_analysis_created
  ON miyagi_conversation_messages(analysis_id, created_at);

CREATE INDEX IF NOT EXISTS idx_miyagi_conversation_journal_created
  ON miyagi_conversation_messages(journal_entry_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_miyagi_conversation_source
  ON miyagi_conversation_messages(user_id, source_ref)
  WHERE source_ref IS NOT NULL;

-- Original journal/check-in comments become first-class Miyagi timeline messages.
INSERT OR IGNORE INTO miyagi_conversation_messages
  (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
SELECT
  'journal:' || id,
  user_id,
  'user',
  body,
  'checkin',
  NULL,
  id,
  'journal_entries:' || id,
  created_at
FROM journal_entries;

-- Existing Miyagi chat is preserved and remains linked to the analysis active at the time.
INSERT OR IGNORE INTO miyagi_conversation_messages
  (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
SELECT
  'miyagi:' || id,
  user_id,
  role,
  body,
  'chat',
  analysis_id,
  NULL,
  'miyagi_messages:' || id,
  created_at
FROM miyagi_messages;

-- Existing journal-assistant questions and answers are unfolded into the same chronology.
INSERT OR IGNORE INTO miyagi_conversation_messages
  (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
SELECT
  'followup:q:' || id,
  user_id,
  'assistant',
  question,
  'checkin',
  NULL,
  journal_entry_id,
  'journal_followups:question:' || id,
  created_at
FROM journal_followups;

INSERT OR IGNORE INTO miyagi_conversation_messages
  (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
SELECT
  'followup:a:' || id,
  user_id,
  'user',
  answer,
  'checkin',
  NULL,
  journal_entry_id,
  'journal_followups:answer:' || id,
  answered_at
FROM journal_followups
WHERE answer IS NOT NULL AND answered_at IS NOT NULL;

-- Imported NoteFlow history is retained for export/provenance but is not shown as current Miyagi chat.
INSERT OR IGNORE INTO miyagi_conversation_messages
  (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
SELECT
  'legacy:' || id,
  user_id,
  role,
  body,
  'legacy',
  NULL,
  NULL,
  'journal_legacy_messages:' || id,
  created_at
FROM journal_legacy_messages;
