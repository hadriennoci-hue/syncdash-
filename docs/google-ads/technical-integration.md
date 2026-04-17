# Technical Integration

This document summarizes the Google Ads implementation in Wizhard.

## Current Code

Google Ads import:

```text
src/lib/functions/google-ads.ts
src/app/api/google-ads/import/route.ts
```

OAuth callback:

```text
src/app/api/auth/google-ads/callback/route.ts
```

Diagnostics:

```text
src/app/api/google-ads/diagnostics/route.ts
```

Campaign planning:

```text
src/app/api/ads/campaigns/route.ts
src/app/api/ads/campaigns/[id]/route.ts
src/app/api/ads/campaigns/[id]/status/route.ts
src/app/(dashboard)/ads/pipeline/page.tsx
```

Publishing runner:

```text
src/lib/functions/ads-publish.ts
src/app/api/cron/route.ts
```

Analytics:

```text
src/lib/functions/ads-analytics.ts
src/app/api/ads/analytics/curated/route.ts
src/app/api/ads/analytics/rebuild/route.ts
src/app/api/ads/analytics/ingest-breakdowns/route.ts
src/app/api/marketing/consolidated/route.ts
```

## API Endpoints

- `GET /api/google-ads/diagnostics`
- `POST /api/google-ads/import`
- `GET /api/ads/campaigns`
- `POST /api/ads/campaigns`
- `PATCH /api/ads/campaigns/:id`
- `PATCH /api/ads/campaigns/:id/status`
- `GET /api/ads/analytics/curated`
- `POST /api/ads/analytics/rebuild`
- `POST /api/ads/analytics/ingest-breakdowns`
- `GET /api/marketing/consolidated`
- `GET /api/cron?task=ads`

## Authentication

All `/api/*` calls use bearer auth unless explicitly documented otherwise.

Production calls from outside the browser also require Cloudflare Access service token headers.

Ads read endpoint:

```text
GET /api/marketing/consolidated
```

accepts `ADS_AGENT_BEARER_TOKEN` with admin token fallback.

## Environment Variables

```env
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REDIRECT_URI=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_API_VERSION=v22
ADS_AGENT_BEARER_TOKEN=
GOOGLE_ADS_PUBLISH_ENABLED=
```

`GOOGLE_ADS_PUBLISH_ENABLED` must be absent or not `1` by default.

## Current MCC / Client Mapping

```env
GOOGLE_ADS_LOGIN_CUSTOMER_ID=3910295284
GOOGLE_ADS_CUSTOMER_ID=4842753150
```

## Publish Behavior

Current first-pass publisher:
- reads due `ads_publish_jobs`
- only supports `provider_id = google_ads`
- only supports `target_type = campaign`
- only supports `action = publish`
- creates a campaign budget
- creates a paused Search campaign
- stores `provider_campaign_id`
- marks the job `success` or `error`

It does not yet create keywords, ads, assets, sitelinks, or conversion actions.

## Safety Requirements

- Always trim secrets before API headers.
- Never return full secrets from diagnostics.
- Never publish enabled campaigns on first creation.
- Never process publish jobs unless the publish flag is enabled.
- Do not use local DB to validate production ad state.

