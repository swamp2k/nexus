ALTER TABLE user_settings ADD COLUMN energy_grid_provider TEXT;
ALTER TABLE user_settings ADD COLUMN energy_supplier_markup_oere REAL NOT NULL DEFAULT 0;
