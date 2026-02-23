// Zero out all inventory on TikTok Shop Shopify at the Ireland location
const SHOP     = 'qanjg5-0h.myshopify.com'
const TOKEN    = process.env.SHOPIFY_TIKTOK_TOKEN
const LOCATION = 'gid://shopify/Location/77845233826'
const API_URL  = `https://${SHOP}/admin/api/2024-01/graphql.json`

async function graphql(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

// Fetch all inventory item IDs (paginated)
async function getAllInventoryItemIds() {
  const ids = []
  let cursor = null
  let hasNext = true

  while (hasNext) {
    const data = await graphql(`
      query($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            title
            variants(first: 50) {
              nodes { inventoryItem { id } }
            }
          }
        }
      }
    `, { cursor })

    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        ids.push(variant.inventoryItem.id)
      }
    }

    hasNext = data.products.pageInfo.hasNextPage
    cursor  = data.products.pageInfo.endCursor
    console.log(`  Fetched ${ids.length} inventory items so far…`)
  }

  return ids
}

// Set quantities to 0 in batches of 100
async function zeroOutInventory(inventoryItemIds) {
  const BATCH = 100
  let total = 0

  for (let i = 0; i < inventoryItemIds.length; i += BATCH) {
    const batch = inventoryItemIds.slice(i, i + BATCH)
    const setQuantities = batch.map(id => ({
      inventoryItemId: id,
      locationId: LOCATION,
      quantity: 0,
    }))

    const data = await graphql(`
      mutation($input: InventorySetOnHandQuantitiesInput!) {
        inventorySetOnHandQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `, {
      input: {
        reason: 'correction',
        setQuantities,
      },
    })

    const errors = data.inventorySetOnHandQuantities.userErrors
    if (errors.length > 0) {
      console.error('  Errors in batch:', errors)
    } else {
      total += batch.length
      console.log(`  ✓ Zeroed ${total} / ${inventoryItemIds.length} items`)
    }
  }
}

console.log('Fetching all inventory items from TikTok Shop Shopify…')
const ids = await getAllInventoryItemIds()
console.log(`\nFound ${ids.length} inventory items. Setting all to 0…`)
await zeroOutInventory(ids)
console.log('\nDone — all stock set to 0.')
