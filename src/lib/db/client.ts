import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

// Cloudflare D1 binding — injected by the Workers runtime
// In local dev, this is provided by Wrangler via wrangler.toml [[d1_databases]] binding
declare global {
  // eslint-disable-next-line no-var
  var __D1_DB: D1Database | undefined
}

function getDb() {
  const binding = (globalThis as unknown as { DB?: D1Database }).DB
  if (!binding) {
    throw new Error(
      'D1 binding "DB" not found. ' +
      'Make sure wrangler.toml has [[d1_databases]] with binding = "DB"'
    )
  }
  return drizzle(binding, { schema })
}

export const db = getDb()
