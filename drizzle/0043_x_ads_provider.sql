ALTER TABLE ads_campaigns ADD COLUMN promoted_tweet_id TEXT;
ALTER TABLE ads_campaigns ADD COLUMN social_post_pk INTEGER REFERENCES social_media_posts(post_pk);

INSERT OR IGNORE INTO ads_providers (provider_id, label, is_active)
VALUES ('x_ads', 'X Ads', 1);

UPDATE ads_providers
SET is_active = 0
WHERE provider_id = 'meta_ads';

INSERT OR IGNORE INTO ads_accounts (
  provider_id,
  account_external_id,
  account_name,
  currency_code,
  timezone,
  status,
  config_json
)
VALUES
  (
    'x_ads',
    '18ce55vgehd',
    'Komputerzz X Ads',
    'EUR',
    'UTC',
    'active',
    '{"socialAccountId":"komputerzz_x","dummyMode":1,"advertiserAccountId":"18ce55vgehd"}'
  ),
  (
    'x_ads',
    '18ce55t47v5',
    'Coincart X Ads',
    'EUR',
    'UTC',
    'active',
    '{"socialAccountId":"coincart_x","dummyMode":1,"advertiserAccountId":"18ce55t47v5"}'
  );
