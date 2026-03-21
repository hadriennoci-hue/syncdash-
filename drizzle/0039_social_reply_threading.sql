-- Migration 39: Reply threading for social posts

ALTER TABLE social_media_posts ADD COLUMN parent_post_pk INTEGER REFERENCES social_media_posts(post_pk);
ALTER TABLE social_media_posts ADD COLUMN reply_to_external_id TEXT;
