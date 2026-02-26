-- Align platform_mappings with current schema fields.
ALTER TABLE platform_mappings ADD COLUMN variant_id TEXT;
ALTER TABLE platform_mappings ADD COLUMN last_synced TEXT;
