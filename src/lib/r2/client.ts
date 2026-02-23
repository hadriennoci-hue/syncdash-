import { getCloudflareContext } from '@opennextjs/cloudflare'

// Cloudflare R2 binding — injected by the Workers runtime.
export function getR2Bucket(): R2Bucket {
  // Try @opennextjs/cloudflare context first
  try {
    const { env } = getCloudflareContext()
    const binding = (env as Record<string, unknown>).R2_IMAGES as R2Bucket | undefined
    if (binding) return binding
  } catch {
    // Outside request context
  }

  // Fallback: globalThis binding
  const binding = (globalThis as unknown as { R2_IMAGES?: R2Bucket }).R2_IMAGES
  if (!binding) {
    throw new Error(
      'R2 binding "R2_IMAGES" not found. ' +
      'Make sure wrangler.toml has [[r2_buckets]] with binding = "R2_IMAGES".'
    )
  }
  return binding
}

export function getR2PublicUrl(): string {
  const url = process.env.R2_PUBLIC_URL
  if (!url) throw new Error('R2_PUBLIC_URL env var is not set.')
  return url.replace(/\/$/, '') // strip trailing slash
}

export function r2KeyFromUrl(url: string, publicUrl: string): string {
  return url.slice(publicUrl.length + 1) // strip "https://images.example.com/"
}
