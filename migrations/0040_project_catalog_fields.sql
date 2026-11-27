ALTER TABLE project_map_registry ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE project_map_registry ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE project_map_registry ADD COLUMN production_url TEXT NOT NULL DEFAULT '';
ALTER TABLE project_map_registry ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1));
ALTER TABLE project_map_registry ADD COLUMN show_repo_public INTEGER NOT NULL DEFAULT 1 CHECK (show_repo_public IN (0, 1));
ALTER TABLE project_map_registry ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
ALTER TABLE project_map_registry ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
