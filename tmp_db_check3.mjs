const ACCOUNT_ID = '22289f45fec4c8545c8a47f6d768cad9'
const DB_ID = 'd7471ca2-fe58-4066-a946-367d062e7e95'
const TOKEN = 'evCDmCthPdgfobO5mAEvMaNbvnGtvow6HvDCULXO'

async function query(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) }
  )
  const json = await res.json()
  if (!json.success) throw new Error(JSON.stringify(json.errors))
  return json.result[0].results
}

const rows = await query(`
  SELECT status, pending_review, COUNT(*) as n,
    SUM(CASE WHEN description IS NULL OR description = '' THEN 1 ELSE 0 END) as no_desc
  FROM products
  GROUP BY status, pending_review
  ORDER BY status, pending_review
`)
console.log('status | pending_review | total | no_description')
rows.forEach(r => console.log(`  [${r.status}] pr=${r.pending_review} | total=${r.n} | no_desc=${r.no_desc}`))
