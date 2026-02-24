-- Migration 11: push status columns for browser-automated channels
ALTER TABLE products ADD COLUMN pushed_xmr_bazaar TEXT NOT NULL DEFAULT 'N';
ALTER TABLE products ADD COLUMN pushed_libre_market TEXT NOT NULL DEFAULT 'N';
