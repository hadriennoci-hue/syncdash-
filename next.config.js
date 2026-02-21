/** @type {import('next').NextConfig} */
const nextConfig = {
  // @cloudflare/next-on-pages handles the edge runtime transformation at build time.
  // Each route sets `export const runtime = 'edge'` individually — no global setting needed.

  // Skip build-time type checking and linting — run these separately via:
  //   npm run type-check   (tsc --noEmit)
  //   npm run lint         (eslint src)
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },
}

module.exports = nextConfig
