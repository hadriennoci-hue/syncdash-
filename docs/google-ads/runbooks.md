# Runbooks

Operational steps for Google Ads work.

## Verify Runtime Config

```http
GET /api/google-ads/diagnostics
```

Expected:
- developer token configured
- no outer whitespace
- customer ID configured
- login customer ID configured
- OAuth token row configured

## Complete OAuth

Use the Google Ads OAuth URL with:

```text
scope=https://www.googleapis.com/auth/adwords
access_type=offline
prompt=consent
```

Callback:

```text
https://wizhard.store/api/auth/google-ads/callback
```

Confirm `platform_tokens` has a `google_ads` row.

## Run Import

```http
POST /api/google-ads/import
```

Body:

```json
{
  "customerId": "4842753150",
  "triggeredBy": "human"
}
```

Import must pass before publishing is enabled.

## Rebuild Analytics

```http
POST /api/ads/analytics/rebuild
```

Body:

```json
{
  "from": "2026-04-16",
  "to": "2026-04-16"
}
```

## Read Curated Analytics

```http
GET /api/ads/analytics/curated?from=2026-04-16&to=2026-04-16&providerId=google_ads
```

## Enable One Publish Test

Only after import passes:

```powershell
"1" | npx wrangler secret put GOOGLE_ADS_PUBLISH_ENABLED --name syncdash
npm run build
npm run deploy
```

Then run:

```http
GET /api/cron?task=ads
```

Expected first publish behavior:
- campaign is created paused
- job is marked `success`
- Wizhard campaign stores `providerCampaignId`

## Disable Publishing

Set the secret to a non-enabled value:

```powershell
"0" | npx wrangler secret put GOOGLE_ADS_PUBLISH_ENABLED --name syncdash
npm run build
npm run deploy
```

## Troubleshooting

### `DEVELOPER_TOKEN_INVALID`

Runtime is sending a token Google does not accept.

Check:
- developer token belongs to the correct production manager account
- token is active
- token has API access
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is the manager account
- diagnostics token fingerprint matches expected value

### `CUSTOMER_NOT_FOUND` Or Access Errors

Check:
- customer ID is the client account
- login customer ID is the MCC
- OAuth user has access to both
- IDs have no dashes

### Import Works But Publish Fails

Check:
- `GOOGLE_ADS_PUBLISH_ENABLED=1`
- campaign has destination URL
- campaign has budget
- publish job is queued and due
- job attempts are below max attempts

### No Metrics

Test accounts may not generate real serving data. Manual test campaigns with tiny budgets may also produce sparse data.

