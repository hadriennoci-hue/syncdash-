PRAGMA foreign_keys = OFF;

-- Drop category_mappings (references categories, no longer needed)
DROP TABLE IF EXISTS category_mappings;

-- Clear all existing product_categories (old Shopify GID references)
DELETE FROM product_categories;

-- Clear all existing categories (old per-platform rows)
DELETE FROM categories;

-- Drop platform column (no longer needed — taxonomy is universal)
ALTER TABLE categories DROP COLUMN platform;

-- Seed 26 canonical universal collections
INSERT INTO categories (id, name, slug, parent_id, collection_type, created_at) VALUES
  ('laptops',            'Laptops',            'laptops',            NULL,          'product', CURRENT_TIMESTAMP),
  ('gaming-laptops',     'Gaming Laptops',     'gaming-laptops',     'laptops',     'product', CURRENT_TIMESTAMP),
  ('work-laptops',       'Work Laptops',       'work-laptops',       'laptops',     'product', CURRENT_TIMESTAMP),
  ('desktops',           'Desktops',           'desktops',           NULL,          'product', CURRENT_TIMESTAMP),
  ('monitors',           'Monitors',           'monitors',           NULL,          'product', CURRENT_TIMESTAMP),
  ('gaming-monitors',    'Gaming Monitors',    'gaming-monitors',    'monitors',    'product', CURRENT_TIMESTAMP),
  ('ultrawide-monitors', 'Ultrawide Monitors', 'ultrawide-monitors', 'monitors',    'product', CURRENT_TIMESTAMP),
  ('tablets',            'Tablets',            'tablets',            NULL,          'product', CURRENT_TIMESTAMP),
  ('projectors',         'Projectors',         'projectors',         NULL,          'product', CURRENT_TIMESTAMP),
  ('graphics-cards',     'Graphics Cards',     'graphics-cards',     NULL,          'product', CURRENT_TIMESTAMP),
  ('storage',            'Storage',            'storage',            NULL,          'product', CURRENT_TIMESTAMP),
  ('accessories',        'Accessories',        'accessories',        NULL,          'product', CURRENT_TIMESTAMP),
  ('mice',               'Mice',               'mice',               'accessories', 'product', CURRENT_TIMESTAMP),
  ('keyboards',          'Keyboards',          'keyboards',          'accessories', 'product', CURRENT_TIMESTAMP),
  ('headsets-earbuds',   'Headsets & Earbuds', 'headsets-earbuds',   'accessories', 'product', CURRENT_TIMESTAMP),
  ('controllers',        'Controllers',        'controllers',        'accessories', 'product', CURRENT_TIMESTAMP),
  ('docking-stations',   'Docking Stations',   'docking-stations',   'accessories', 'product', CURRENT_TIMESTAMP),
  ('laptop-bags',        'Laptop Bags',        'laptop-bags',        'accessories', 'product', CURRENT_TIMESTAMP),
  ('connectivity',       'Connectivity',       'connectivity',       'accessories', 'product', CURRENT_TIMESTAMP),
  ('webcams',            'Webcams',            'webcams',            'accessories', 'product', CURRENT_TIMESTAMP),
  ('audio',              'Audio',              'audio',              'accessories', 'product', CURRENT_TIMESTAMP),
  ('cameras',            'Cameras',            'cameras',            'accessories', 'product', CURRENT_TIMESTAMP),
  ('gaming-consoles',    'Gaming Consoles',    'gaming-consoles',    NULL,          'product', CURRENT_TIMESTAMP),
  ('gaming-chairs',      'Gaming Chairs',      'gaming-chairs',      NULL,          'product', CURRENT_TIMESTAMP),
  ('gaming-desks',       'Gaming Desks',       'gaming-desks',       NULL,          'product', CURRENT_TIMESTAMP),
  ('electric-scooters',  'Electric Scooters',  'electric-scooters',  NULL,          'product', CURRENT_TIMESTAMP);

PRAGMA foreign_keys = ON;
