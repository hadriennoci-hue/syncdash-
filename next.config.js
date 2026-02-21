/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for Cloudflare Pages deployment
  experimental: {
    runtime: 'edge',
  },
}

module.exports = nextConfig
