CREATE TABLE IF NOT EXISTS display_dashboards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  layout_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_display_dashboards_user
  ON display_dashboards(user_id, updated_at);

ALTER TABLE display_pairing_codes ADD COLUMN dashboard_id TEXT REFERENCES display_dashboards(id) ON DELETE CASCADE;
ALTER TABLE display_devices ADD COLUMN dashboard_id TEXT REFERENCES display_dashboards(id) ON DELETE SET NULL;

INSERT INTO display_dashboards (id, user_id, name, theme, layout_json, created_at, updated_at)
SELECT lower(hex(randomblob(16))), u.id, 'Køkken', 'system',
       '[{"id":"energy.price.next24h","size":"wide"},{"id":"energy.price.current","size":"small"},{"id":"calendar.waste.next","size":"small"},{"id":"weather.current","size":"small"},{"id":"melcloud.atw.current","size":"small"}]',
       datetime('now'), datetime('now')
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM display_dashboards d WHERE d.user_id = u.id);

UPDATE display_devices
SET dashboard_id = (
  SELECT d.id FROM display_dashboards d
  WHERE d.user_id = display_devices.user_id
  ORDER BY d.created_at ASC LIMIT 1
)
WHERE dashboard_id IS NULL;
