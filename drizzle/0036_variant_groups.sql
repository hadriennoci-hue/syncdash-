-- Add variant_group_id to products
-- Products sharing a variant_group_id are keyboard-layout variants of the same laptop.
-- NULL = standalone product (no variant relationship).

ALTER TABLE products ADD COLUMN variant_group_id TEXT;
CREATE INDEX idx_products_variant_group_id ON products (variant_group_id) WHERE variant_group_id IS NOT NULL;
