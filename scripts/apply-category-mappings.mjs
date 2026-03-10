import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const DEV_VARS = path.join(ROOT, '.dev.vars')
const TMP_SQL = path.join(ROOT, 'scripts', 'tmp-category-mappings.sql')

const MAPPINGS = [
  { wooName: 'Displays', handle: 'displays' },
  { wooName: 'Cases', handle: 'cases' },
  { wooName: 'Input devices', handle: 'input-devices' },
  { wooName: 'Laptops', handle: 'laptops' },
  { wooName: 'Tablets', handle: 'tablets' },
  { wooName: 'Audio & headphones', handle: 'audio' },
  { wooName: 'SWEDISH QWERTY', handle: 'swe-qwerty' },
  { wooName: 'AZERTY', handle: 'fra-azerty' },
  { wooName: 'GER QWERTZ', handle: 'ger-qwertz' },
  { wooName: 'SPA QWERTY', handle: 'spa-qwerty' },
  { wooName: 'ITA QWERTY', handle: 'ita-qwerty' },
  { wooName: 'UK QWERTY', handle: 'uk-qwerty' },
  { wooName: 'SWISS QWERTZ', handle: 'swiss-qwertz' },
  { wooName: 'US QWERTY', handle: 'us-qwerty' },
  { wooName: 'Lifestyle', handle: 'lifestyle' },
  { wooName: 'Desktops', handle: 'desktops' },
  { wooName: 'gpu', handle: 'gpu' },
]

function parseEnvFile(filepath) {
  const out = {}
  const text = fs.readFileSync(filepath, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

function mustGet(env, key) {
  const v = env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

function esc(value) {
  return String(value).replace(/'/g, "''")
}

async function fetchJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status} ${url}: ${body}`)
  }
  return res.json()
}

async function refreshShopifyToken(shop, clientId, clientSecret) {
  const data = await fetchJson(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  if (!data.access_token) throw new Error(`No Shopify token returned for ${shop}`)
  return data.access_token
}

async function fetchWooCategories(baseUrl, key, secret) {
  const all = []
  let page = 1
  while (true) {
    const url = `${baseUrl.replace(/\/$/, '')}/wp-json/wc/v3/products/categories?per_page=100&page=${page}&consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`
    const batch = await fetchJson(url)
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < 100) break
    page += 1
  }
  return all
}

async function fetchShopifyCollectionByHandle(shop, token, handle) {
  const query = `
    query CollectionByHandle($q: String!) {
      collections(first: 1, query: $q) {
        nodes { id title handle }
      }
    }
  `
  const data = await fetchJson(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables: { q: `handle:${handle}` } }),
  })
  if (data.errors?.length) {
    throw new Error(`Shopify GraphQL errors for ${shop}/${handle}: ${JSON.stringify(data.errors)}`)
  }
  return data.data?.collections?.nodes?.[0] ?? null
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed\n${res.stdout}\n${res.stderr}`)
  }
  return res.stdout
}

function sqlUpsertCategory(id, platform, name, slug) {
  return `INSERT INTO categories (id, platform, name, slug, collection_type, created_at)
VALUES ('${esc(id)}','${esc(platform)}','${esc(name)}','${esc(slug)}','product', datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  platform=excluded.platform,
  name=excluded.name,
  slug=excluded.slug,
  collection_type='product';`
}

async function main() {
  const env = parseEnvFile(DEV_VARS)

  const wooBase = mustGet(env, 'COINCART_URL')
  const wooKey = mustGet(env, 'COINCART_KEY')
  const wooSecret = mustGet(env, 'COINCART_SECRET')

  const shopKomp = mustGet(env, 'SHOPIFY_KOMPUTERZZ_SHOP')
  const kompClientId = mustGet(env, 'SHOPIFY_KOMPUTERZZ_CLIENT_ID')
  const kompClientSecret = mustGet(env, 'SHOPIFY_KOMPUTERZZ_CLIENT_SECRET')

  const shopTiktok = mustGet(env, 'SHOPIFY_TIKTOK_SHOP')
  const tiktokClientId = mustGet(env, 'SHOPIFY_TIKTOK_CLIENT_ID')
  const tiktokClientSecret = mustGet(env, 'SHOPIFY_TIKTOK_CLIENT_SECRET')

  const [tokenKomp, tokenTiktok, wooCategories] = await Promise.all([
    refreshShopifyToken(shopKomp, kompClientId, kompClientSecret),
    refreshShopifyToken(shopTiktok, tiktokClientId, tiktokClientSecret),
    fetchWooCategories(wooBase, wooKey, wooSecret),
  ])

  const wooByName = new Map()
  for (const c of wooCategories) {
    if (!c?.name || c.id == null) continue
    wooByName.set(String(c.name).trim().toLowerCase(), c)
  }

  const sql = []
  const report = []

  for (const pair of MAPPINGS) {
    const woo = wooByName.get(pair.wooName.trim().toLowerCase())
    if (!woo) {
      report.push(`missing Woo category: ${pair.wooName}`)
      continue
    }
    const wooId = `woo_${woo.id}`
    sql.push(sqlUpsertCategory(wooId, 'woocommerce', String(woo.name), String(woo.slug ?? pair.handle)))

    const [ck, ct] = await Promise.all([
      fetchShopifyCollectionByHandle(shopKomp, tokenKomp, pair.handle),
      fetchShopifyCollectionByHandle(shopTiktok, tokenTiktok, pair.handle),
    ])

    let foundAnyShopify = false
    for (const item of [
      { platform: 'shopify_komputerzz', col: ck },
      { platform: 'shopify_tiktok', col: ct },
    ]) {
      if (!item.col) continue
      foundAnyShopify = true
      sql.push(sqlUpsertCategory(item.col.id, item.platform, item.col.title, item.col.handle))
      sql.push(
        `INSERT INTO category_mappings (shopify_collection_id, woo_category_id)
VALUES ('${esc(item.col.id)}','${esc(wooId)}')
ON CONFLICT(shopify_collection_id, woo_category_id) DO NOTHING;`
      )
      report.push(`mapped ${item.platform}:${item.col.handle} -> ${woo.name}`)
    }

    if (!foundAnyShopify) {
      report.push(`missing Shopify collection in both shops: ${pair.handle}`)
    }
  }

  fs.writeFileSync(TMP_SQL, `${sql.join('\n')}\n`, 'utf8')

  run('npx', ['wrangler', 'd1', 'execute', 'syncdash-db', '--local', '--file', TMP_SQL])
  run('npx', ['wrangler', 'd1', 'execute', 'syncdash-db', '--remote', '--file', TMP_SQL])

  console.log('Applied mappings to local + remote D1.')
  console.log('--- Report ---')
  for (const line of report) console.log(line)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
