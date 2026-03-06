-- Migration 17: eBay IE sales channel
ALTER TABLE products ADD COLUMN pushed_ebay_ie TEXT NOT NULL DEFAULT 'N';

