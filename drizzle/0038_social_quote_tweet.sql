-- Migration 38: Add quote_tweet_id to social_media_posts

ALTER TABLE social_media_posts ADD COLUMN quote_tweet_id TEXT;
