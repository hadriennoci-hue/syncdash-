/** @type {import('next').NextConfig} */
const nextConfig = {
  // @cloudflare/next-on-pages handles the edge runtime transformation at build time.
  // Each route sets `export const runtime = 'edge'` individually — no global setting needed.
}

module.exports = nextConfig
