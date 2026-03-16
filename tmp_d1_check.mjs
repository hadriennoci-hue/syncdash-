const ACCOUNT_ID = '22289f45fec4c8545c8a47f6d768cad9'
const DB_ID = 'd7471ca2-fe58-4066-a946-367d062e7e95'
const TOKEN = 'evCDmCthPdgfobO5mAEvMaNbvnGtvow6HvDCULXO'

async function query(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    }
  )
  const json = await res.json()
  if (!json.success) throw new Error(JSON.stringify(json.errors))
  return json.result[0].results
}

// 1. Description coverage
const descStats = await query(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) as has_description,
    SUM(CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END) as missing_description
  FROM products
`)
console.log('=== DESCRIPTION ===')
console.log(descStats[0])

// 2. Products missing description
const missingDesc = await query(`
  SELECT id, status, pending_review, substr(title,1,60) as title
  FROM products
  WHERE description IS NULL OR description = ''
  ORDER BY id
`)
if (missingDesc.length > 0) {
  console.log('\nProducts missing description:')
  missingDesc.forEach(p => console.log(`  [${p.status}] ${p.id} | ${p.title}`))
} else {
  console.log('  All products have a description ✓')
}

// 3. Attribute coverage
const attrStats = await query(`
  SELECT
    (SELECT COUNT(*) FROM products) as total_products,
    COUNT(DISTINCT product_id) as products_with_attributes
  FROM product_metafields
  WHERE namespace = 'attributes'
`)
console.log('\n=== ATTRIBUTES ===')
console.log(attrStats[0])

// 4. Products missing attributes
const missingAttrs = await query(`
  SELECT p.id, p.status, p.pending_review, substr(p.title,1,60) as title
  FROM products p
  LEFT JOIN product_metafields m ON p.id = m.product_id AND m.namespace = 'attributes'
  WHERE m.id IS NULL
  ORDER BY p.id
`)
if (missingAttrs.length > 0) {
  console.log('\nProducts missing attributes:')
  missingAttrs.forEach(p => console.log(`  [${p.status}] pr=${p.pending_review} ${p.id} | ${p.title}`))
} else {
  console.log('  All products have attributes ✓')
}
