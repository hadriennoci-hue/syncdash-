-- Migration 22: multi-image support for social posts

ALTER TABLE social_media_posts ADD COLUMN image_urls TEXT;
