-- Seed for the Projects registry (migration 0038). Safe to re-run: existing
-- rows are left alone, so edits made in the Nexus UI are never overwritten.
-- Apply with: npx wrangler d1 execute nexus --remote --file tools/projects-seed.sql
-- Cloudflare names were checked against the live account on 2026-10-07.
-- Rows marked "Bekræft" in notes are best guesses waiting for Martin.
INSERT INTO project_registry (id, name, description, url, status, repos_json, workers_json, pages_json, d1_json, notes, updated_at) VALUES
('nexus', 'Nexus', 'Familiens personlige PWA', NULL, 'active', '["swamp2k/nexus"]', '["nexus"]', '[]', '["nexus"]', NULL, '2026-10-07T00:00:00Z'),
('login-central', 'Login Central', '', NULL, 'active', '["swamp2k/login-central"]', '["login-central"]', '[]', '["login-central"]', NULL, '2026-10-07T00:00:00Z'),
('hvadnu', 'Hvadnu', '', NULL, 'active', '["swamp2k/hvadnu"]', '["hvadnu"]', '[]', '["hvadnu-prod"]', NULL, '2026-10-07T00:00:00Z'),
('star-rewards', 'Star Rewards', '', NULL, 'active', '["swamp2k/star-rewards","swamp2k/starrewards-landing"]', '["star-rewards","star-rewards-staging"]', '[]', '["star-rewards","star-rewards-staging","star-rewards-dev"]', NULL, '2026-10-07T00:00:00Z'),
('haveguide-v2', 'HaveGuide v2', 'Trænger til arbejde', NULL, 'active', '["swamp2k/haveguide-v2"]', '[]', '[]', '[]', 'Bekræft: bruger v2 worker have-guide / d1 haveguide fra v1?', '2026-10-07T00:00:00Z'),
('pcwatch', 'PC Watch', '', NULL, 'active', '["swamp2k/pcwatch"]', '["pcwatch-worker"]', '[]', '["workstationwatch"]', NULL, '2026-10-07T00:00:00Z'),
('pc-fleet', 'PC Fleet', '', NULL, 'active', '["swamp2k/pc-fleet"]', '["pcfleet-worker"]', '[]', '[]', 'Bekræft: stadig i brug? Worker uændret siden 30. juni.', '2026-10-07T00:00:00Z'),
('mars-animator', 'Mars Animator', '', NULL, 'active', '["swamp2k/mars-animator"]', '["mars-animator"]', '[]', '["keyframe-db"]', NULL, '2026-10-07T00:00:00Z'),
('dba-gold', 'DBA Gold', '', NULL, 'active', '["swamp2k/dba-gold"]', '["dba-gold"]', '[]', '[]', NULL, '2026-10-07T00:00:00Z'),
('unraidwatch', 'Unraid Watch', '', NULL, 'active', '["swamp2k/unraidwatch"]', '["unraidwatch-api"]', '[]', '["unraidwatch"]', NULL, '2026-10-07T00:00:00Z'),
('noteflow', 'NoteFlow', '', NULL, 'active', '["swamp2k/noteflow-v2"]', '["noteflow-api"]', '[]', '["noteflow","noteflow-staging"]', NULL, '2026-10-07T00:00:00Z'),
('copyarr', 'Copyarr', 'Go-daemon på Unraid', NULL, 'active', '["swamp2k/copyarr"]', '[]', '[]', '[]', NULL, '2026-10-07T00:00:00Z'),
('112-dispatch', '112 Dispatch', '', NULL, 'active', '["swamp2k/112-dispatch"]', '["112-dispatch"]', '[]', '["112-dispatch-leaderboard"]', NULL, '2026-10-07T00:00:00Z'),
('compareit', 'CompareIt', '', NULL, 'active', '["swamp2k/compareit"]', '["compareit"]', '[]', '["compareit"]', NULL, '2026-10-07T00:00:00Z'),
('savethe', 'SaveThe', '', NULL, 'active', '["swamp2k/savethe"]', '["savethe"]', '[]', '[]', NULL, '2026-10-07T00:00:00Z'),
('eventyr', 'Eventyr', '', NULL, 'active', '["swamp2k/eventyr"]', '[]', '[]', '["eventyr"]', NULL, '2026-10-07T00:00:00Z'),
('web-scraper', 'Bilbasen-scraper', '', NULL, 'active', '["swamp2k/web-scraper"]', '["bilbasen-scraper"]', '[]', '[]', 'Bekræft: er web-scraper og bilbasen-scraper samme projekt?', '2026-10-07T00:00:00Z'),
('cc-compendium', 'CC Compendium', 'Roblox-opskriftsopslag', NULL, 'done', '[]', '[]', '[]', '["cc-compendium-db"]', 'Kendt: koden er tabt, intet repo. "Uden kode"-flaget er forventet.', '2026-10-07T00:00:00Z'),
('cubewiki', 'CubeWiki', '', NULL, 'done', '["swamp2k/cubewiki"]', '[]', '[]', '["cubewiki"]', NULL, '2026-10-07T00:00:00Z'),
('haveguide-v1', 'HaveGuide v1', 'Gammel version', NULL, 'retired', '["swamp2k/HaveGuide"]', '["have-guide"]', '[]', '["haveguide"]', 'Bekræft at v2 ikke bruger worker/d1 før de slettes.', '2026-10-07T00:00:00Z'),
('nexus-backups', 'Nexus-backups', 'Gamle backup-repos', NULL, 'retired', '["swamp2k/nexus_backup","swamp2k/nexus-backup"]', '[]', '[]', '[]', NULL, '2026-10-07T00:00:00Z'),
('multirequest', 'MultiRequest', '', NULL, 'retired', '["swamp2k/MultiRequest"]', '[]', '[]', '[]', NULL, '2026-10-07T00:00:00Z')
ON CONFLICT(id) DO NOTHING;
