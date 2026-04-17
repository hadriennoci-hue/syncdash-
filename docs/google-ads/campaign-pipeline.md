# Google Ads Campaign Pipeline

This document defines the Wizhard campaign lifecycle for Google Ads.

## Current Status

Wizhard has campaign planning tables, UI routes, and publish job tables. It is not yet fully connected to Google Ads input/output. Manual Google Ads campaigns may exist before Wizhard can import or publish them.

## Lifecycle

1. `draft`
   - Campaign is proposed.
   - Product, destination, budget, copy, targeting, and notes may still be incomplete.
   - No Google Ads API call should happen.

2. `approved`
   - Campaign has been reviewed by a human or trusted agent.
   - It is valid as a plan but not queued for publishing.
   - Destination URL must be checked before moving forward.

3. `scheduled`
   - Campaign is ready to be published at a specific time.
   - Wizhard inserts an `ads_publish_jobs` row.
   - Campaign must not be scheduled while `destination_pending = 1`.

4. `queued publish job`
   - `ads_publish_jobs.status = queued`.
   - The ads publisher scans due jobs.
   - Current implementation is guarded by `GOOGLE_ADS_PUBLISH_ENABLED=1`.

5. `paused`
   - First safe external Google Ads state.
   - Wizhard-created campaigns must start paused.
   - Manual activation in Google Ads or a future explicit Wizhard "go live" action is required.

6. `live`
   - Campaign is serving.
   - Future Wizhard support should only mark this after confirming provider state.

7. `completed`
   - Campaign reached end date or was manually ended.

8. `canceled`
   - Campaign should not launch.
   - Existing queued jobs should be canceled or ignored.

## Publish Rules

- Publisher must be disabled unless `GOOGLE_ADS_PUBLISH_ENABLED=1`.
- Publisher must never create an enabled campaign on first publish.
- Publisher must store provider IDs returned by Google Ads.
- Publisher must mark job `success` or `error`.
- Publisher must record enough request/response data for troubleshooting without storing secrets.

## Manual Campaigns

Until the Google Ads input/output connection is complete, manually created Google Ads campaigns should be documented in `test-campaigns.md` and later reconciled into Wizhard by campaign name, customer ID, and final URL.

