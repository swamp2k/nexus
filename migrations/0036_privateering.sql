-- Privateering: latest rTorrent torrents + Copyarr completed-file snapshot,
-- pushed in by a local agent (Copyarr/rTorrent are not reachable from the Worker directly).
-- Single shared snapshot, replaced wholesale on each ingest.
CREATE TABLE privateering_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NOT NULL,
  torrents_json TEXT NOT NULL,
  copyarr_files_json TEXT NOT NULL
);
