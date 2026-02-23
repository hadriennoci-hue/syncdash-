import { drizzle } from 'drizzle-orm/d1'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import * as schema from './schema'

function getDb() {
  // Try @opennextjs/cloudflare context first (wrangler dev / production)
  try {
    const { env } = getCloudflareContext()
    const binding = (env as Record<string, unknown>).DB as D1Database | undefined
    if (binding) return drizzle(binding, { schema })
  } catch {
    // getCloudflareContext throws outside of a request context (e.g. build time)
  }

  // Fallback: globalThis binding (legacy @cloudflare/next-on-pages)
  const binding = (globalThis as unknown as { DB?: D1Database }).DB
  if (!binding) {
    throw new Error(
      'D1 binding "DB" not found. ' +
      'Make sure wrangler.toml has [[d1_databases]] with binding = "DB"'
    )
  }
  return drizzle(binding, { schema })
}

// Lazy proxy — defers DB initialisation to request time, not module load time.
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop: string | symbol) {
    return Reflect.get(getDb(), prop)
  },
})

export { getDb as getDbClient }
