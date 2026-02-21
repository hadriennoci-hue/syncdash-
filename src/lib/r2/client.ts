// Cloudflare R2 binding — injected by the Workers runtime.
// In local dev, Wrangler simulates R2 via [[r2_buckets]] in wrangler.toml.
export function getR2Bucket(): R2Bucket {
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
