# Testing And Sandbox

This document describes Google Ads test-account workflow for Wizhard.

## Current State

Wizhard has Google Ads configuration and OAuth storage, but Google Ads API import is currently blocked by developer token validation. Until imports pass, publishing must stay disabled.

Current intended mapping:

```env
GOOGLE_ADS_LOGIN_CUSTOMER_ID=3910295284
GOOGLE_ADS_CUSTOMER_ID=4842753150
GOOGLE_ADS_API_VERSION=v22
```

Meaning:
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is the MCC / manager account.
- `GOOGLE_ADS_CUSTOMER_ID` is the client account.

## Required Secrets

Cloudflare Worker secrets:

```env
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_REDIRECT_URI=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_API_VERSION=
ADS_AGENT_BEARER_TOKEN=
```

Local `.dev.vars` should mirror these for local testing.

## OAuth

OAuth callback:

```text
https://wizhard.store/api/auth/google-ads/callback
```

OAuth must request:

```text
https://www.googleapis.com/auth/adwords
```

OAuth should use:

```text
access_type=offline
prompt=consent
```

Success stores a `platform_tokens` row with `platform = google_ads`.

## Import Test

Run import only after OAuth and secrets are configured:

```http
POST /api/google-ads/import
```

Example body:

```json
{
  "customerId": "4842753150",
  "triggeredBy": "human"
}
```

Import must succeed before enabling publishing.

## Runtime Diagnostics

Protected endpoint:

```http
GET /api/google-ads/diagnostics
```

It returns fingerprints only:
- token configured
- length
- first characters
- last characters
- whitespace flag
- OAuth row presence

It must never return full secrets.

## Publishing Guard

Publishing is disabled unless:

```env
GOOGLE_ADS_PUBLISH_ENABLED=1
```

Do not set this until:
- import passes
- customer IDs are verified
- queued job is intentionally ready to test

## Test Account Limitations

Google Ads test accounts are useful for API object creation and validation. They should not be expected to produce real serving data, spend, impressions, clicks, or conversions.

