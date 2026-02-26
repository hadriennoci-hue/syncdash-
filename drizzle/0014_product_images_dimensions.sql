-- Add optional image dimensions used by current Drizzle schema.
ALTER TABLE product_images ADD COLUMN width INTEGER;
ALTER TABLE product_images ADD COLUMN height INTEGER;
