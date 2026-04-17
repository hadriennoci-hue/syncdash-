# Google Ads Documentation

This folder documents how Wizhard should plan, launch, import, and analyze Google Ads campaigns.

Current state:
- Wizhard has an internal ad campaign pipeline.
- Wizhard is not yet connected to Google Ads as a full input/output system.
- Google Ads OAuth and import endpoints exist, but the Google Ads API developer token still needs to pass validation before imports/publishing can be used.
- Publishing code must remain guarded by `GOOGLE_ADS_PUBLISH_ENABLED=1`.
- Campaigns created through Wizhard must be created paused first.

## Documents

- `campaign-pipeline.md` - campaign lifecycle inside Wizhard.
- `campaign-setup-rules.md` - rules for campaign creation and approval.
- `testing-and-sandbox.md` - test account and sandbox workflow.
- `performance-analysis.md` - metrics, decision rules, and review cadence.
- `attribution.md` - UTM, GCLID, orders, and attribution model.
- `technical-integration.md` - endpoints, secrets, tables, and code references.
- `runbooks.md` - operational steps and troubleshooting.
- `campaign-templates.md` - reusable campaign templates.
- `test-campaigns.md` - current manually created test campaigns.

## Non-Negotiable Rules

- Do not enable Google Ads publishing until import works.
- Do not publish from Wizhard unless the campaign has a destination URL.
- Create Google Ads campaigns paused first.
- Keep test-account work separate from production campaign work.
- Every campaign mutation triggered by Wizhard must create an auditable row or log entry.
- Do not treat Google-reported conversions and Wizhard-attributed purchases as the same metric without labeling the attribution model.
- Use production D1 as source of truth for Wizhard campaign records.

