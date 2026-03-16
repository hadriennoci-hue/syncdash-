import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const DB_PATH = 'C:/syncdash/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/2c06f50807890c53a0614d3b037fd2f343511a6e493e36775e1def4e3bda12dd.sqlite'

// Use wrangler's bundled better-sqlite3 or fall back to a simple approach
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

// Write SQL to a temp file and run via wrangler
const sql = `
SELECT
  (SELECT COUNT(*) FROM products) as total,
  (SELECT COUNT(*) FROM products WHERE description IS NOT NULL AND description != '') as has_description,
  (SELECT COUNT(*) FROM products WHERE description IS NULL OR description = '') as missing_description,
  (SELECT COUNT(DISTINCT product_id) FROM product_metafields WHERE namespace='attributes') as has_attributes;

SELECT id, substr(title,1,60) as title FROM products WHERE description IS NULL OR description = '';

SELECT p.id, substr(p.title,1,60) as title
FROM products p
LEFT JOIN product_metafields m ON p.id = m.product_id AND m.namespace = 'attributes'
WHERE m.id IS NULL;
`
writeFileSync('C:/syncdash/tmp_db_check.sql', sql)
console.log('SQL file written')
