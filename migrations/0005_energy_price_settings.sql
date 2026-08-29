ALTER TABLE user_settings ADD COLUMN energy_price_area TEXT CHECK (energy_price_area IN ('DK1', 'DK2'));
