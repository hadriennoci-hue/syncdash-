const TOKEN = process.env.CLOUDFLARE_API_TOKEN
const ACCOUNT_ID = '22289f45fec4c8545c8a47f6d768cad9'
const DB_ID = 'd7471ca2-fe58-4066-a946-367d062e7e95'

if (!TOKEN) {
  throw new Error('Missing CLOUDFLARE_API_TOKEN')
}

async function query(sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql })
  })
  const d = await r.json()
  return d.result?.[0]?.results ?? d
}

const stats = await query(`SELECT
  (SELECT COUNT(*) FROM products) as total,
  (SELECT COUNT(*) FROM products WHERE description IS NOT NULL AND description != '') as has_description,
  (SELECT COUNT(*) FROM products WHERE description IS NULL OR description = '') as missing_description,
  (SELECT COUNT(DISTINCT product_id) FROM product_metafields WHERE namespace='attributes') as has_attributes`)

console.log('=== DB STATS ===')
console.log(stats[0])

const noDesc = await query(`SELECT id, status, substr(title,1,60) as title FROM products WHERE description IS NULL OR description = '' LIMIT 20`)
if (noDesc.length) {
  console.log('\n=== MISSING DESCRIPTION ===')
  noDesc.forEach(p => console.log(` [${p.status}] ${p.id} | ${p.title}`))
}
