# Deployment & Infrastructure

## Hosting Strategy

**Platform:** Cloudflare Pages + D1 + Workers
**Rationale:** Zero cost, native D1 integration, global edge deployment, no ops overhead

| Component | Service | Notes |
|-----------|---------|-------|
| Frontend + API | Cloudflare Pages | Next.js via @cloudflare/next-on-pages |
| Database | Cloudflare D1 | SQLite, free tier, bound to Pages |
| Static assets | Cloudflare CDN | Auto-included with Pages |
| Background jobs | None (Phase 1) | Future: Cloudflare Cron Triggers |

---

## Environments

| Environment | URL | Branch | Purpose |
|-------------|-----|--------|---------|
| Production | syncdash.pages.dev | `master` | Live tool |
| Preview | pr-[n].syncdash.pages.dev | PRs | Code review |
| Development | localhost:3000 | local | Local dev with Wrangler |

---

## Environment Variables

```bash
# App
NEXT_PUBLIC_APP_URL=https://syncdash.pages.dev

# Authentication (single token — used by web UI and AI agent)
AGENT_BEARER_TOKEN=<long-random-secret>

# WooCommerce — coincart.store
WOO_BASE_URL=https://coincart.store
WOO_CONSUMER_KEY=ck_xxx
WOO_CONSUMER_SECRET=cs_xxx

# Shopify — komputerzz.com (source of truth)
SHOPIFY_KOMPUTERZZ_SHOP=komputerzz.myshopify.com
SHOPIFY_KOMPUTERZZ_TOKEN=shpat_xxx

# Shopify — TikTok Shop account
SHOPIFY_TIKTOK_SHOP=tiktok-account.myshopify.com
SHOPIFY_TIKTOK_TOKEN=shpat_xxx

# Future platforms (uncomment when adding)
# PLATFORM_4_BASE_URL=
# PLATFORM_4_API_KEY=
# PLATFORM_5_BASE_URL=
# PLATFORM_5_API_KEY=
```

All variables set in **Cloudflare Pages → Settings → Environment Variables**. Never commit to Git.

---

## Cloudflare D1 Setup

```bash
# Create D1 database
npx wrangler d1 create syncdash-db

# Add to wrangler.toml
[[d1_databases]]
binding = "DB"
database_name = "syncdash-db"
database_id = "<id-from-above>"

# Run migrations
npx wrangler d1 execute syncdash-db --file=./drizzle/0001_init.sql

# For local dev
npx wrangler d1 execute syncdash-db --local --file=./drizzle/0001_init.sql
```

---

## wrangler.toml

```toml
name = "syncdash"
compatibility_date = "2024-01-01"
pages_build_output_dir = ".vercel/output/static"

[[d1_databases]]
binding = "DB"
database_name = "syncdash-db"
database_id = "YOUR_D1_DATABASE_ID"
```

---

## CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run test

  deploy:
    if: github.ref == 'refs/heads/master'
    needs: [lint-and-type-check, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: syncdash
          directory: .vercel/output/static
```

---

## Database Migrations on Deploy

```bash
# Local: generate migration from schema change
npm run db:generate

# Local: apply migration
npm run db:migrate

# Production: apply migration via Wrangler
npx wrangler d1 execute syncdash-db --file=./drizzle/XXXX_migration.sql
```

Migration files are versioned in `/drizzle/`. Never edit existing migration files — always create a new one.

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up local env
cp .env.example .env.local
# Fill in your API keys

# 3. Create local D1 database
npx wrangler d1 execute syncdash-db --local --file=./drizzle/0001_init.sql

# 4. Start dev server
npm run dev
# → http://localhost:3000
```

---

## Monitoring

For v1 (internal tool), no external monitoring is configured. The `sync_log` table serves as the audit trail. Check it via Drizzle Studio:

```bash
npm run db:studio
```

Future: Cloudflare Analytics dashboard provides basic request metrics.

---

## Security Checklist

- [ ] `AGENT_BEARER_TOKEN` set in Cloudflare env vars (not in code)
- [ ] All platform API keys in Cloudflare env vars
- [ ] No secrets in Git
- [ ] HTTPS enforced (automatic via Cloudflare Pages)
- [ ] Bearer token is long and random (min 32 chars)
- [ ] Rotate tokens periodically
